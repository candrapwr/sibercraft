import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { config } from "./config.js";
import { isConversationalPrompt, runAgent } from "./agent.js";
import { buildStandaloneHtml } from "./exporter.js";
import { HttpError, SessionStore } from "./session-store.js";
import { resolveWithin } from "./path-sandbox.js";
import { captureFullPage } from "./screenshot.js";
import { initDb } from "./db.js";
import { UserStore } from "./auth-store.js";
import {
  resolveUser,
  resolveOwner,
  requireAdmin,
  isAdmin,
  isSecureRequest,
  isValidEmail,
  noteRegisterAttempt,
  noteLoginFailure,
  clearLoginFailures,
} from "./auth.js";
import { parseCookies } from "./session-cookie.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  createSessionToken,
  sessionCookieHeader,
  clearCookieHeader,
} from "./session-cookie.js";
import { sendMail } from "./mail.js";
import { buildVerificationEmail } from "./verification-mail.js";

const publicDir = resolve("public");
const store = new SessionStore(config.dataDir);
const db = await initDb(config.dataDir);
const userStore = new UserStore(db);
const activeRuns = new Map();
const previewDrafts = new Map();
const MAX_IMAGE_BYTES = 1_000_000;
const MAX_TOTAL_IMAGE_BYTES = MAX_IMAGE_BYTES * 4;
await store.init();

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    const user = await resolveUser(request, {
      userStore,
      secret: config.auth.secret,
      cookieName: config.auth.cookieName,
    });
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url, user);
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

async function handleApi(request, response, url, user) {
  const { method } = request;

  // --- Auth routes (publik, tidak butuh login) ---
  if (url.pathname.startsWith("/api/auth/")) {
    return handleAuth(request, response, url, user);
  }

  if (method === "GET" && url.pathname === "/api/config") {
    return sendJson(response, 200, {
      aiConfigured: Boolean(config.deepseek.apiKey),
      model: config.deepseek.model,
      multimodalConfigured: Boolean(config.deepseek.multimodal.apiKey && config.deepseek.multimodal.model),
    });
  }

  // --- Admin routes (wajib admin) ---
  const adminMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]{36})(?:\/(.+))?$/i);
  if (adminMatch) {
    requireAdmin(user);
    const targetId = adminMatch[1];
    const subAction = adminMatch[2];

    // Hapus user + semua project-nya (tidak boleh hapus diri sendiri).
    if (method === "DELETE" && !subAction) {
      if (targetId === user.id) throw new HttpError(400, "Tidak dapat menghapus akun sendiri");
      const target = await userStore.findById(targetId);
      if (!target) throw new HttpError(404, "User tidak ditemukan");
      const projectsRemoved = await store.removeByOwner(target.id);
      await userStore.deleteUser(target.id);
      return sendJson(response, 200, { ok: true, projectsRemoved });
    }

    // Aktivasi manual (status -> active, tanpa password).
    if (method === "POST" && subAction === "activate") {
      const updated = await userStore.activateManually(targetId);
      return sendJson(response, 200, toPublicUser(updated));
    }

    // Ubah role/tier.
    if (method === "PATCH" && !subAction) {
      const body = await readJson(request);
      const updated = await userStore.updateUser(targetId, {
        role: body.role,
        tier: body.tier,
      });
      return sendJson(response, 200, toPublicUser(updated));
    }
  }
  if (method === "GET" && url.pathname === "/api/admin/users") {
    requireAdmin(user);
    const users = (await userStore.listUsers()).map(toPublicUser);
    // Enrich dengan jumlah project per user (dari session-store filesystem).
    const enriched = await Promise.all(users.map(async (u) => ({
      ...u,
      projectCount: await store.countByOwner(u.id),
    })));
    return sendJson(response, 200, enriched);
  }

  // --- Session routes: login ATAU anon (resolve owner dari cookie user/anon) ---
  const owner = await resolveOwner(request, response, user, {
    cookieName: config.auth.anonCookieName,
    maxAgeDays: config.auth.anonMaxAgeDays,
    isSecure: isSecureRequest(request),
  });

  if (method === "GET" && url.pathname === "/api/sessions") {
    const sessions = await store.list(owner.ownerId, { isAdmin: isAdmin(user) });
    const enriched = await Promise.all(sessions.map(async (session) => ({
      ...session,
      checkpointCount: await store.checkpointCount(session.id),
    })));
    return sendJson(response, 200, enriched);
  }
  if (method === "POST" && url.pathname === "/api/sessions") {
    // Batas jumlah project untuk anon.
    if (owner.isAnon) {
      const count = await store.countByOwner(owner.ownerId);
      if (count >= config.auth.anonProjectLimit) {
        throw new HttpError(403, `Batas ${config.auth.anonProjectLimit} project tercapai. Login untuk membuat lebih banyak.`);
      }
    }
    const body = await readJson(request);
    const session = await store.create({ ...body, model: config.deepseek.model, ownerId: owner.ownerId });
    return sendJson(response, 201, session);
  }

  const match = url.pathname.match(/^\/api\/sessions\/([0-9a-f-]{36})(?:\/(.+))?$/i);
  if (!match) throw new HttpError(404, "Endpoint tidak ditemukan");
  const [, id, action = ""] = match;
  // Kepemilikan divalidasi di store.get (admin lihat semua).
  const access = { ownerId: owner.ownerId, isAdmin: isAdmin(user) };

  if (method === "GET" && !action) {
    const session = await store.getForView(id, access);
    return sendJson(response, 200, { ...session, checkpointCount: await store.checkpointCount(id) });
  }
  if (method === "DELETE" && !action) {
    await store.getForEdit(id, access); // validasi kepemilikan
    if (activeRuns.has(id)) throw new HttpError(409, "Hentikan proses AI sebelum menghapus sesi");
    await store.remove(id);
    previewDrafts.delete(id);
    return sendJson(response, 200, { ok: true });
  }
  if (method === "GET" && action === "history") {
    await store.getForView(id, access);
    const history = await store.history(id);
    return sendJson(response, 200, history.map((message) => toPublicMessage(message, id)).filter(Boolean));
  }
  if (method === "GET" && action === "files") {
    await store.getForView(id, access);
    return sendJson(response, 200, await store.listFiles(id));
  }
  if (method === "GET" && action === "export/html") {
    if (activeRuns.has(id)) throw new HttpError(409, "Tunggu proses AI selesai sebelum export");
    const session = await store.getForView(id, access);
    const html = await buildStandaloneHtml(store.workspaceDir(id));
    const filename = `${safeFilename(session.name)}.html`;
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
    response.end(html);
    return;
  }
  if (method === "GET" && action === "export/image") {
    if (activeRuns.has(id)) throw new HttpError(409, "Tunggu proses AI selesai sebelum export");
    const session = await store.getForView(id, access);
    const width = Math.min(2560, Math.max(320, Number.parseInt(url.searchParams.get("width") || "1440", 10) || 1440));
    const previewUrl = `http://127.0.0.1:${config.port}/preview/${id}/?export=${Date.now()}`;
    let image;
    try {
      image = await captureFullPage({ url: previewUrl, width });
    } catch (error) {
      throw new HttpError(503, error.message || "Browser screenshot tidak tersedia");
    }
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${safeFilename(session.name)}.png"`,
      "Content-Length": image.length,
      "Cache-Control": "no-store",
    });
    response.end(image);
    return;
  }
  if (method === "GET" && action === "file") {
    await store.getForView(id, access);
    const path = url.searchParams.get("path");
    if (!path) throw new HttpError(400, "Parameter path wajib diisi");
    return sendJson(response, 200, { path, content: await store.readWorkspaceFile(id, path) });
  }
  if (method === "PUT" && action === "file") {
    await store.getForEdit(id, access);
    if (activeRuns.has(id)) throw new HttpError(409, "File tidak dapat diedit ketika AI sedang bekerja");
    const body = await readJson(request, 2_100_000);
    const history = await store.history(id);
    await store.createCheckpoint(id, history.length);
    await store.writeWorkspaceFile(id, body.path, body.content);
    return sendJson(response, 200, { ok: true });
  }
  if (method === "POST" && action === "undo") {
    await store.getForEdit(id, access);
    if (activeRuns.has(id)) throw new HttpError(409, "Hentikan proses AI sebelum melakukan undo");
    return sendJson(response, 200, await store.undo(id));
  }
  if (method === "POST" && action === "stop") {
    await store.getForEdit(id, access);
    const controller = activeRuns.get(id);
    if (controller) controller.abort();
    return sendJson(response, 200, { stopped: Boolean(controller) });
  }
  if (method === "POST" && action === "chat") {
    return streamChat(request, response, id, access);
  }
  throw new HttpError(404, "Endpoint tidak ditemukan");
}

/** Handler untuk /api/auth/* (register, verify, login, logout, me). */
async function handleAuth(request, response, url, user) {
  const { method } = request;
  const { pathname } = url;

  if (method === "GET" && pathname === "/api/auth/me") {
    if (user) return sendJson(response, 200, toPublicUser(user));
    // Anon: kembalikan profil anon dengan ownerId dari cookie (set cookie bila baru).
    const owner = await resolveOwner(request, response, null, {
      cookieName: config.auth.anonCookieName,
      maxAgeDays: config.auth.anonMaxAgeDays,
      isSecure: isSecureRequest(request),
    });
    return sendJson(response, 200, { isAnon: true, ownerId: owner.ownerId, role: "anon", tier: "guest" });
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const body = await readJson(request);
    const email = String(body.email || "").trim();
    if (!isValidEmail(email)) throw new HttpError(400, "Email tidak valid");
    noteRegisterAttempt(email, request);

    const role = config.auth.adminEmails.has(email.toLowerCase()) ? "admin" : "user";
    const created = await userStore.createPending({ email, role });

    const expiresAt = new Date(Date.now() + config.auth.verificationTokenHours * 3600_000).toISOString();
    const plainToken = await userStore.issueVerificationToken(created.id, expiresAt);
    const verifyUrl = `${config.appUrl}/?verify=${encodeURIComponent(plainToken)}`;

    try {
      await sendVerificationEmail({ to: created.email, verifyUrl });
    } catch (error) {
      // Rollback: hapus user + token agar email dapat didaftarkan ulang.
      await userStore.deleteUser(created.id).catch(() => {});
      console.error("Gagal mengirim email verifikasi:", error.message);
      throw new HttpError(502, "Gagal mengirim email verifikasi. Coba lagi nanti.");
    }

    return sendJson(response, 201, {
      ok: true,
      message: "Email verifikasi telah dikirim. Periksa kotak masuk Anda.",
    });
  }

  if (method === "GET" && pathname === "/api/auth/verify-info") {
    const token = url.searchParams.get("token") || "";
    const peek = await userStore.peekVerificationToken(token);
    if (!peek || !peek.valid || !peek.user) {
      return sendJson(response, 200, { valid: false });
    }
    return sendJson(response, 200, { valid: true, email: peek.user.email });
  }

  if (method === "POST" && pathname === "/api/auth/set-password") {
    const body = await readJson(request);
    const token = String(body.token || "");
    const password = String(body.password || "");
    if (password.length < config.auth.passwordMinLength) {
      throw new HttpError(400, `Kata sandi minimal ${config.auth.passwordMinLength} karakter`);
    }
    if (password.length > 128) throw new HttpError(400, "Kata sandi terlalu panjang");

    const consumed = await userStore.consumeVerificationToken(token);
    if (!consumed) throw new HttpError(400, "Tautan verifikasi tidak valid atau sudah kadaluarsa");

    const hash = await hashPassword(password);
    const updated = await userStore.setPassword(consumed.userId, hash);
    return sendJson(response, 200, { ok: true, message: "Akun berhasil diaktifkan. Silakan masuk." });
  }

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(request);
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (!email || !password) throw new HttpError(400, "Email dan kata sandi wajib diisi");

    const found = await userStore.findByEmail(email);
    const ok = found && found.status === "active" && found.passwordHash
      ? await verifyPassword(password, found.passwordHash)
      : false;
    if (!ok) {
      if (found) noteLoginFailure(email, request);
      // Pesan generik agar tidak membocorkan apakah email terdaftar.
      throw new HttpError(401, "Email atau kata sandi salah");
    }
    clearLoginFailures(email, request);

    // Klaim project anon (jika ada) ke akun ini sebelum set session cookie.
    const cookies = parseCookies(request.headers.cookie);
    const anonId = cookies[config.auth.anonCookieName];
    const secure = isSecureRequest(request);
    const setCookies = [];
    if (anonId) {
      await store.claimSessions(anonId, found.id);
      setCookies.push(clearCookieHeader(config.auth.anonCookieName, secure));
    }

    const token = createSessionToken({ uid: found.id }, config.auth.secret, config.auth.maxAgeDays);
    const maxAgeMs = config.auth.maxAgeDays * 24 * 60 * 60 * 1000;
    setCookies.push(sessionCookieHeader(
      config.auth.cookieName, token, maxAgeMs, secure,
    ));
    response.setHeader("Set-Cookie", setCookies);
    return sendJson(response, 200, toPublicUser(found));
  }

  if (method === "POST" && pathname === "/api/auth/logout") {
    response.setHeader("Set-Cookie", clearCookieHeader(
      config.auth.cookieName, isSecureRequest(request),
    ));
    return sendJson(response, 200, { ok: true });
  }

  throw new HttpError(404, "Endpoint tidak ditemukan");
}

async function sendVerificationEmail({ to, verifyUrl }) {
  if (!config.mail.host || !config.mail.username || !config.mail.fromAddress) {
    throw new Error("Konfigurasi mail belum lengkap");
  }
  const message = buildVerificationEmail({
    to,
    verifyUrl,
    appName: "SiberCraft",
    hours: config.auth.verificationTokenHours,
  });
  await sendMail({
    host: config.mail.host,
    port: config.mail.port,
    username: config.mail.username,
    password: config.mail.password,
    encryption: config.mail.encryption,
    fromAddress: config.mail.fromAddress,
    fromName: config.mail.fromName,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

function toPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    tier: user.tier,
    status: user.status,
  };
}

async function streamChat(request, response, id, access) {
  if (activeRuns.has(id)) throw new HttpError(409, "AI masih bekerja pada sesi ini");
  const body = await readJson(request, 16_000_000);
  const imagePayloads = parseImagePayloads(body.images);
  const prompt = String(body.prompt || "").trim() || (imagePayloads.length ? "Gunakan gambar ini sebagai referensi untuk membuat atau memperbarui mockup." : "");
  if (!prompt) throw new HttpError(400, "Prompt atau gambar wajib diisi");
  if (prompt.length > 20_000) throw new HttpError(413, "Prompt terlalu panjang");
  if (imagePayloads.length && !(config.deepseek.multimodal.apiKey && config.deepseek.multimodal.model)) {
    throw new HttpError(400, "Model multimodal belum dikonfigurasi");
  }
  const session = await store.getForEdit(id, access);
  const history = await store.history(id);
  const images = [];
  for (const image of imagePayloads) {
    const attachment = await store.saveUploadedImage(id, image);
    images.push({ ...attachment, dataUrl: image.dataUrl });
  }
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
      images,
      config: config.deepseek,
      webScreenshot: config.webScreenshot,
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

function toPublicMessage(message, sessionId) {
  if (message.role === "user") return {
    role: "user",
    content: message.content,
    attachments: (message.attachments || []).map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      url: `/preview/${sessionId}/${attachment.path.split("/").map(encodeURIComponent).join("/")}`,
    })),
  };
  if (message.role === "assistant") {
    const calls = (message.tool_calls || []).map((call) => ({
      id: call.id,
      name: call.function?.name || "tool",
      arguments: call.function?.arguments || "",
    }));
    if (!message.content?.trim() && !calls.length) return null;
    return {
      role: "assistant",
      content: message.content || "",
      toolCalls: calls,
      model: message.model || "",
      aiMode: message.ai_mode || "",
      modelsUsed: Array.isArray(message.models_used) ? message.models_used : [],
    };
  }
  if (message.role === "tool") return {
    role: "tool",
    toolCallId: message.tool_call_id,
    name: message.name,
    content: publicToolResult(message.name, String(message.content)),
  };
  return null;
}

function parseImagePayloads(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Payload gambar tidak valid");
  if (value.length > 4) throw new HttpError(400, "Maksimal 4 gambar per turn");
  let totalSize = 0;
  return value.map((item) => {
    const name = String(item?.name || "image").slice(0, 120);
    const dataUrl = String(item?.dataUrl || "");
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
    if (!match) throw new HttpError(400, "Format gambar tidak didukung");
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Ukuran setiap gambar maksimal 1 MB");
    totalSize += buffer.length;
    if (totalSize > MAX_TOTAL_IMAGE_BYTES) throw new HttpError(413, "Total gambar maksimal 4 MB per turn");
    return { name, type: match[1].toLowerCase(), dataUrl, buffer };
  });
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

function safeFilename(value) {
  const filename = String(value || "sibercraft-export").trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return filename || "sibercraft-export";
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
  console.log(`Mail: ${config.mail.host ? `${config.mail.fromAddress} via ${config.mail.host}:${config.mail.port}` : "belum dikonfigurasi"}`);
  console.log(`Admin: ${config.auth.adminEmails.size ? [...config.auth.adminEmails].join(", ") : "(tidak ada)"}`);
});
