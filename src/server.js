import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { config } from "./config.js";
import { isConversationalPrompt, runAgent } from "./agent.js";
import { HttpError, SessionStore } from "./session-store.js";
import { resolveWithin } from "./path-sandbox.js";

const publicDir = resolve("public");
const store = new SessionStore(config.dataDir);
const activeRuns = new Map();
const previewDrafts = new Map();
await store.init();

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    if (url.pathname.startsWith("/preview/")) {
      await handlePreview(response, url);
      return;
    }
    await servePublic(response, url.pathname);
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }
    const status = error.status || (error.code === "ENOENT" ? 404 : 500);
    if (status >= 500) console.error(error);
    sendJson(response, status, { error: status === 500 ? "Terjadi kesalahan pada server" : error.message });
  }
});

async function handleApi(request, response, url) {
  const { method } = request;
  if (method === "GET" && url.pathname === "/api/config") {
    return sendJson(response, 200, {
      aiConfigured: Boolean(config.deepseek.apiKey),
      model: config.deepseek.model,
    });
  }
  if (method === "GET" && url.pathname === "/api/sessions") {
    const sessions = await store.list();
    const enriched = await Promise.all(sessions.map(async (session) => ({
      ...session,
      checkpointCount: await store.checkpointCount(session.id),
    })));
    return sendJson(response, 200, enriched);
  }
  if (method === "POST" && url.pathname === "/api/sessions") {
    const body = await readJson(request);
    const session = await store.create({ ...body, model: config.deepseek.model });
    return sendJson(response, 201, session);
  }

  const match = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})(?:\/(.+))?$/i);
  if (!match) throw new HttpError(404, "Endpoint tidak ditemukan");
  const [, id, action = ""] = match;

  if (method === "GET" && !action) {
    const session = await store.get(id);
    return sendJson(response, 200, { ...session, checkpointCount: await store.checkpointCount(id) });
  }
  if (method === "DELETE" && !action) {
    if (activeRuns.has(id)) throw new HttpError(409, "Hentikan proses AI sebelum menghapus sesi");
    await store.remove(id);
    previewDrafts.delete(id);
    return sendJson(response, 200, { ok: true });
  }
  if (method === "GET" && action === "history") {
    const history = await store.history(id);
    return sendJson(response, 200, history.map(toPublicMessage).filter(Boolean));
  }
  if (method === "GET" && action === "files") {
    return sendJson(response, 200, await store.listFiles(id));
  }
  if (method === "GET" && action === "file") {
    const path = url.searchParams.get("path");
    if (!path) throw new HttpError(400, "Parameter path wajib diisi");
    return sendJson(response, 200, { path, content: await store.readWorkspaceFile(id, path) });
  }
  if (method === "PUT" && action === "file") {
    if (activeRuns.has(id)) throw new HttpError(409, "File tidak dapat diedit ketika AI sedang bekerja");
    const body = await readJson(request, 2_100_000);
    const history = await store.history(id);
    await store.createCheckpoint(id, history.length);
    await store.writeWorkspaceFile(id, body.path, body.content);
    return sendJson(response, 200, { ok: true });
  }
  if (method === "POST" && action === "undo") {
    if (activeRuns.has(id)) throw new HttpError(409, "Hentikan proses AI sebelum melakukan undo");
    return sendJson(response, 200, await store.undo(id));
  }
  if (method === "POST" && action === "stop") {
    const controller = activeRuns.get(id);
    if (controller) controller.abort();
    return sendJson(response, 200, { stopped: Boolean(controller) });
  }
  if (method === "POST" && action === "chat") {
    return streamChat(request, response, id);
  }
  throw new HttpError(404, "Endpoint tidak ditemukan");
}

async function streamChat(request, response, id) {
  if (activeRuns.has(id)) throw new HttpError(409, "AI masih bekerja pada sesi ini");
  const body = await readJson(request);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new HttpError(400, "Prompt wajib diisi");
  if (prompt.length > 20_000) throw new HttpError(413, "Prompt terlalu panjang");
  const session = await store.get(id);
  const history = await store.history(id);
  const checkpoint = isConversationalPrompt(prompt)
    ? null
    : await store.createCheckpoint(id, history.length);

  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });
  const controller = new AbortController();
  activeRuns.set(id, controller);
  let finished = false;
  const emit = (event) => {
    let publicEvent = event;
    if (event.type === "preview_draft") {
      const path = normalizeDraftPath(event.path);
      if (!path) return;
      const drafts = previewDrafts.get(id) || new Map();
      drafts.set(path, event.content);
      previewDrafts.set(id, drafts);
      publicEvent = { type: "preview_draft", callIndex: event.callIndex, path, size: event.content.length };
    } else if (event.type === "preview" && event.path) {
      removePreviewDraft(id, event.path);
    } else if (event.type === "preview_draft_clear" && event.path) {
      removePreviewDraft(id, event.path);
    }
    if (!response.destroyed) response.write(`${JSON.stringify(publicEvent)}\n`);
  };
  response.on("close", () => {
    if (!finished) controller.abort();
  });

  try {
    const result = await runAgent({
      session,
      store,
      prompt,
      config: config.deepseek,
      signal: controller.signal,
      emit,
    });
    if (checkpoint && !result?.mutated) await store.discardCheckpoint(id, checkpoint);
  } catch (error) {
    const message = error.name === "AbortError" ? "Proses dihentikan" : error.message;
    emit({ type: "error", message });
  } finally {
    finished = true;
    activeRuns.delete(id);
    previewDrafts.delete(id);
    response.end();
  }
}

async function handlePreview(response, url) {
  const match = url.pathname.match(/^\/preview\/([0-9a-f-]{36})(?:\/(.*))?$/i);
  if (!match) throw new HttpError(404, "Preview tidak ditemukan");
  const [, id, requested = ""] = match;
  await store.get(id);
  const relativePath = requested || "index.html";
  const fullPath = await resolveWithin(store.workspaceDir(id), relativePath);
  const draft = previewDrafts.get(id)?.get(normalizeDraftPath(relativePath));
  let content;
  if (draft !== undefined) {
    content = Buffer.from(draft, "utf8");
  } else {
    const info = await stat(fullPath);
    if (!info.isFile()) throw new HttpError(404, "File preview tidak ditemukan");
    content = await readFile(fullPath);
  }
  response.writeHead(200, {
    "Content-Type": mimeType(fullPath),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src https:; frame-ancestors 'self'",
  });
  response.end(content);
}

function normalizeDraftPath(value) {
  const path = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\0")) return null;
  const segments = path.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.includes("..")) return null;
  return segments.join("/");
}

function removePreviewDraft(id, path) {
  const drafts = previewDrafts.get(id);
  const normalized = normalizeDraftPath(path);
  if (!drafts || !normalized) return;
  drafts.delete(normalized);
  if (!drafts.size) previewDrafts.delete(id);
}

async function servePublic(response, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  let fullPath;
  try {
    fullPath = await resolveWithin(publicDir, requested);
    const info = await stat(fullPath);
    if (!info.isFile()) throw new Error("not-file");
  } catch {
    fullPath = join(publicDir, "index.html");
  }
  const content = await readFile(fullPath);
  response.writeHead(200, {
    "Content-Type": mimeType(fullPath),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(content);
}

function toPublicMessage(message) {
  if (message.role === "user") return { role: "user", content: message.content };
  if (message.role === "assistant") {
    const calls = (message.tool_calls || []).map((call) => ({
      id: call.id,
      name: call.function?.name || "tool",
      arguments: call.function?.arguments || "",
    }));
    if (!message.content?.trim() && !calls.length) return null;
    return { role: "assistant", content: message.content || "", toolCalls: calls };
  }
  if (message.role === "tool") return {
    role: "tool",
    toolCallId: message.tool_call_id,
    name: message.name,
    content: publicToolResult(message.name, String(message.content)),
  };
  return null;
}

function publicToolResult(name, result) {
  if (result.startsWith("Error:")) return result.slice(0, 160);
  if (name === "read_file") return "File berhasil dibaca";
  if (name === "list_dir") return "Struktur workspace diperiksa";
  return result.slice(0, 160);
}

async function readJson(request, limit = 1_000_000) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw new HttpError(413, "Request terlalu besar");
  }
  try {
    return body ? JSON.parse(body) : {};
  } catch {
    throw new HttpError(400, "JSON request tidak valid");
  }
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function mimeType(path) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  })[extname(path).toLowerCase()] || "application/octet-stream";
}

server.listen(config.port, () => {
  console.log(`Mockup AI berjalan di http://localhost:${config.port}`);
  console.log(`DeepSeek: ${config.deepseek.apiKey ? config.deepseek.model : "API key belum dikonfigurasi"}`);
});
