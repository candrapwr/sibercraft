import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { config } from "./config/config.js";
import { isConversationalPrompt, runAgent } from "./ai/agent.js";
import { buildStandaloneHtml, buildFileZip, buildWorkspaceZip } from "./workspace/exporter.js";
import { HttpError, SessionStore } from "./workspace/session-store.js";
import { resolveWithin } from "./workspace/path-sandbox.js";
import { captureFullPage } from "./media/screenshot.js";
import { generateThumbnail, buildLayoutHtml } from "./media/thumbnail.js";
import { initDb } from "./db/db.js";
import { UserStore } from "./auth/auth-store.js";
import {
  resolveUser,
  resolveOwner,
  requireUser,
  requireAdmin,
  isAdmin,
  isSecureRequest,
  isValidEmail,
  noteRegisterAttempt,
  noteLoginFailure,
  clearLoginFailures,
} from "./auth/auth.js";
import { parseCookies } from "./auth/session-cookie.js";
import { hashPassword, verifyPassword } from "./auth/password.js";
import {
  createSessionToken,
  sessionCookieHeader,
  clearCookieHeader,
} from "./auth/session-cookie.js";
import { sendMail } from "./mail/mail.js";
import { buildVerificationEmail } from "./mail/verification-mail.js";
import { deriveKey } from "./auth/crypto-secret.js";
import { ProviderStore } from "./providers/provider-store.js";
import { ErrorLogStore } from "./observability/error-log-store.js";

const publicDir = resolve("public");
const store = new SessionStore(config.dataDir);
const db = await initDb(config.dataDir);
const userStore = new UserStore(db);
// AES-GCM key for encrypting user-supplied API keys at rest. Derived from the
// same SESSION_SECRET that signs session cookies, so its persistence caveats
// are identical: if SESSION_SECRET is unset (ephemeral dev secret), stored API
// keys become undecryptable after a restart (treated gracefully as "missing").
const cryptoKey = await deriveKey(config.auth.secret);
const providerStore = new ProviderStore(db, cryptoKey, config.auth.secret);
const errorLogStore = new ErrorLogStore(db);
if (!process.env.SESSION_SECRET?.trim()) {
  console.warn("SESSION_SECRET belum diatur: API key pengguna tidak akan survive restart server.");
}
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
    if (url.pathname.startsWith("/__thumb_layout/")) {
      await handleThumbLayout(request, response, url);
      return;
    }
    await servePublic(request, response, url.pathname + url.search);
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

  // --- Account-scoped routes (wajib login) ---
  if (url.pathname.startsWith("/api/me/")) {
    return handleMe(request, response, url, user);
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
  // --- Admin error log routes (wajib admin) ---
  if (url.pathname === "/api/admin/errors") {
    requireAdmin(user);
    if (method === "GET") {
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      const filters = {
        limit: limit ? Number.parseInt(limit, 10) : 50,
        offset: offset ? Number.parseInt(offset, 10) : 0,
        model: url.searchParams.get("model") || undefined,
        ownerId: url.searchParams.get("ownerId") || undefined,
        errorType: url.searchParams.get("errorType") || undefined,
        since: url.searchParams.get("since") || undefined,
      };
      const logs = errorLogStore.list(filters);
      const total = errorLogStore.count(filters);
      return sendJson(response, 200, { logs, total, limit: filters.limit, offset: filters.offset });
    }
    if (method === "DELETE") {
      const removed = errorLogStore.clearAll();
      return sendJson(response, 200, { ok: true, removed });
    }
    throw new HttpError(405, "Method tidak diizinkan");
  }
  if (url.pathname.startsWith("/api/admin/errors/") && method === "DELETE") {
    requireAdmin(user);
    const id = url.pathname.slice("/api/admin/errors/".length);
    const deleted = errorLogStore.delete(id);
    if (!deleted) throw new HttpError(404, "Log tidak ditemukan");
    return sendJson(response, 200, { ok: true });
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
    // Lazy backfill: untuk session yang punya frame tapi belum punya thumbnail,
    // generate di background (best-effort). Berguna untuk project existing yang
    // dibuat sebelum fitur thumbnail aktif.
    for (const session of enriched) {
      if (Array.isArray(session.frames) && session.frames.length > 0) {
        backfillThumbnail(session.id);
      }
    }
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
    const entryFile = normalizeDraftPath(url.searchParams.get("file") || "") || "index.html";
    const html = await buildStandaloneHtml(store.workspaceDir(id), entryFile);
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
    const fileRaw = normalizeDraftPath(url.searchParams.get("file") || "") || "index.html";
    const previewUrl = `http://127.0.0.1:${config.port}/preview/${id}/${encodeURIComponent(fileRaw)}?export=${Date.now()}`;
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
  // Export a single frame's HTML + locally-referenced assets as a ZIP.
  if (method === "GET" && action === "export/zip") {
    if (activeRuns.has(id)) throw new HttpError(409, "Tunggu proses AI selesai sebelum export");
    const session = await store.getForView(id, access);
    const entryFile = normalizeDraftPath(url.searchParams.get("file") || "") || "index.html";
    const zip = await buildFileZip(store.workspaceDir(id), entryFile);
    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeFilename(session.name)}.zip"`,
      "Content-Length": zip.length,
      "Cache-Control": "no-store",
    });
    response.end(zip);
    return;
  }
  // Export the ENTIRE workspace (all files + per-frame screenshots) as a ZIP.
  if (method === "GET" && action === "export/zip-all") {
    if (activeRuns.has(id)) throw new HttpError(409, "Tunggu proses AI selesai sebelum export");
    const session = await store.getForView(id, access);
    // Capture a screenshot per frame (best-effort; skipped on failure).
    const extra = [];
    const frames = Array.isArray(session.frames) ? session.frames : [];
    for (const frame of frames) {
      const file = normalizeDraftPath(frame.file || "") || "index.html";
      const width = Math.min(2560, Math.max(320, (frame.w) || 1280));
      const previewUrl = `http://127.0.0.1:${config.port}/preview/${id}/${encodeURIComponent(file)}?export=${Date.now()}`;
      try {
        const image = await captureFullPage({ url: previewUrl, width });
        const base = file.replace(/\.html?$/i, "");
        extra.push({ path: `screenshots/${base || "preview"}.png`, data: image });
      } catch {
        // screenshot unavailable (no headless browser) — skip silently
      }
    }
    const zip = await buildWorkspaceZip(store.workspaceDir(id), extra);
    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeFilename(session.name)}.zip"`,
      "Content-Length": zip.length,
      "Cache-Control": "no-store",
    });
    response.end(zip);
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
  // Rename session. action = "rename"
  if (method === "POST" && action === "rename") {
    if (activeRuns.has(id)) throw new HttpError(409, "Hentikan proses AI sebelum mengganti nama");
    await store.getForEdit(id, access);
    const body = await readJson(request);
    const name = String(body?.name || "").trim().slice(0, 80);
    if (!name) throw new HttpError(400, "Nama project wajib diisi");
    const updated = await store.update(id, { name });
    return sendJson(response, 200, updated);
  }
  // Update frame position/device (drag persistence). action = "frame/:frameId"
  if (method === "PATCH" && action.startsWith("frame/")) {
    await store.getForEdit(id, access);
    const frameId = action.slice("frame/".length);
    const body = await readJson(request);
    const patch = {};
    if (typeof body.x === "number") patch.x = Math.round(body.x);
    if (typeof body.y === "number") patch.y = Math.round(body.y);
    if (typeof body.device === "string") patch.device = body.device;
    const frame = await store.updateFrame(id, frameId, patch);
    return sendJson(response, 200, frame);
  }
  if (method === "DELETE" && action.startsWith("frame/")) {
    await store.getForEdit(id, access);
    const frameId = action.slice("frame/".length);
    const frames = await store.removeFrame(id, frameId);
    return sendJson(response, 200, { frames });
  }
  // Migrate legacy sessions (no frames field) → create 1 frame for index.html
  // so old content stays visible in the canvas view.
  if (method === "POST" && action === "migrate-frames") {
    await store.getForEdit(id, access);
    const session = await store.get(id);
    if (Array.isArray(session.frames) && session.frames.length > 0) {
      return sendJson(response, 200, { frames: session.frames });
    }
    await store.addFrame(id, { file: "index.html", device: "desktop" });
    const updated = await store.get(id);
    return sendJson(response, 200, { frames: updated.frames });
  }
  if (method === "POST" && action === "chat") {
    return streamChat(request, response, id, access);
  }
  if (method === "GET" && action === "thumbnail") {
    // Existence/access check; admin lihat semua, publik boleh, privat hanya pemilik.
    const session = await store.getForView(id, access);
    const thumb = await store.readThumbnail(id);
    if (!thumb) throw new HttpError(404, "Thumbnail belum tersedia");
    const etag = `"${session.updatedAt || ""}-${thumb.mtimeMs}"`;
    if (request.headers["if-none-match"] === etag) {
      response.writeHead(304, { ETag: etag, "Cache-Control": "private, max-age=3600" });
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": thumb.buffer.length,
      "ETag": etag,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(thumb.buffer);
    return;
  }
  // Manual thumbnail regeneration (triggered from canvas header button).
  if (method === "POST" && action === "regenerate-thumbnail") {
    await store.getForEdit(id, access);
    await generateThumbnailForSession(id);
    return sendJson(response, 200, { ok: true });
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

/** Handler untuk /api/me/* (provider config + token usage). Wajib login. */
async function handleMe(request, response, url, user) {
  requireUser(user);
  const { method } = request;
  const { pathname } = url;

  if (method === "GET" && pathname === "/api/me/provider") {
    return sendJson(response, 200, await providerStore.getRedacted(user.id));
  }
  if (method === "PUT" && pathname === "/api/me/provider") {
    const body = await readJson(request);
    return sendJson(response, 200, await saveProviderConfig(user.id, body));
  }
  if (method === "DELETE" && pathname === "/api/me/provider") {
    await providerStore.clear(user.id);
    return sendJson(response, 200, { ok: true });
  }
  if (method === "GET" && pathname === "/api/me/usage") {
    return sendJson(response, 200, providerStore.getUsage(user.id));
  }
  throw new HttpError(404, "Endpoint tidak ditemukan");
}

/**
 * Validasi dan simpan konfigurasi provider milik user.
 * Field yang divalidasi: endpoint (http/https URL), model (non-empty, ≤120),
 * apiKey (≤500). apiKey kosong → key lama dipertahankan (keep-existing).
 */
async function saveProviderConfig(userId, body) {
  const payload = {
    enabled: Boolean(body?.enabled),
    primary: validateProviderPayload(body?.primary),
    multimodal: validateProviderPayload(body?.multimodal),
  };
  return providerStore.save(userId, payload);
}

function validateProviderPayload(value) {
  if (!value || typeof value !== "object") return { apiKey: "", baseUrl: "", model: "" };
  const apiKey = value.apiKey == null ? "" : String(value.apiKey);
  if (apiKey.length > 500) throw new HttpError(400, "API key terlalu panjang (maksimal 500 karakter)");
  const baseUrl = String(value.baseUrl || "").trim();
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    throw new HttpError(400, "Endpoint harus berupa URL http atau https");
  }
  if (baseUrl.length > 500) throw new HttpError(400, "Endpoint terlalu panjang");
  const model = String(value.model || "").trim();
  if (model.length > 120) throw new HttpError(400, "Model terlalu panjang (maksimal 120 karakter)");
  return { apiKey, baseUrl, model };
}

/**
 * Bangun agent config dengan override provider pribadi bila user mengaktifkannya.
 * Mengembalikan { config, providerSource }:
 *   - providerSource "user"  → primary pakai key user (usage akan di-track).
 *   - providerSource "server" → pakai config.deepseek default.
 * Multimodal: bila user set multimodal sendiri, override; selain itu fallback default.
 */
async function resolveProviderConfig(userId, baseConfig) {
  const provider = await providerStore.get(userId);
  if (!provider.enabled || !provider.primary.apiKey) {
    return { config: baseConfig, providerSource: "server" };
  }
  const merged = { ...baseConfig, _providerSource: "user" };
  merged.apiKey = provider.primary.apiKey;
  if (provider.primary.baseUrl) merged.baseUrl = provider.primary.baseUrl.replace(/\/$/, "");
  if (provider.primary.model) merged.model = provider.primary.model;
  // Multimodal override hanya bila user punya key multimodal sendiri.
  if (provider.multimodal.apiKey) {
    merged.multimodal = {
      apiKey: provider.multimodal.apiKey,
      baseUrl: (provider.multimodal.baseUrl || merged.multimodal.baseUrl).replace(/\/$/, ""),
      model: provider.multimodal.model || merged.multimodal.model,
    };
  }
  return { config: merged, providerSource: "user" };
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

  let result = null;
  try {
    // Override default provider with the user's BYOK config if they enabled one.
    // Only applies to logged-in users; anon always uses the server default.
    const { config: agentConfig } = access.ownerId && !access.ownerId.startsWith("anon-")
      ? await resolveProviderConfig(access.ownerId, config.deepseek)
      : { config: config.deepseek };
    result = await runAgent({
      session,
      store,
      prompt,
      images,
      config: agentConfig,
      webScreenshot: config.webScreenshot,
      signal: controller.signal,
      emit,
      onCreateFrame: async ({ file, device }) => store.addFrame(id, { file, device }),
    });
    if (checkpoint && !result?.mutated) await store.discardCheckpoint(id, checkpoint);
  } catch (error) {
    const isAbort = error.name === "AbortError";
    const message = isAbort ? "Proses dihentikan" : error.message;
    emit({ type: "error", message });
    // Log non-abort AI errors for admin observability. AbortError is a user
    // action (Stop), not a real failure, so it is intentionally excluded.
    // Best-effort: a logging failure must never break the chat flow.
    if (!isAbort) {
      try {
        const ctx = error._aiContext || {};
        const model = ctx.modelsUsed?.model || agentConfig.model;
        const mode = ctx.modelsUsed?.mode || (imagePayloads.length ? "multimodal" : "primary");
        errorLogStore.log({
          sessionId: id,
          ownerId: access.ownerId,
          model,
          providerSource: agentConfig._providerSource || "server",
          mode,
          errorMessage: error.message,
          errorType: classifyError(error),
          iteration: ctx.iteration ?? null,
        });
      } catch {
        // Swallow logging errors — chat must not break.
      }
    }
  } finally {
    finished = true;
    activeRuns.delete(id);
    previewDrafts.delete(id);
    response.end();
    // Attribute token consumption to the user ONLY when their own private
    // provider key was used for this turn (operator-default usage is the
    // server's cost and intentionally not billed here).
    if (result?.providerSource === "user" && result.promptTokens + result.completionTokens > 0) {
      try { providerStore.incrementUsage(access.ownerId, result.promptTokens, result.completionTokens); } catch {}
    }
    // Bila AI mengubah/membuat file, regenerate thumbnail di background.
    // Fire-and-forget (best-effort): skip diam-diam bila Chrome tidak ada.
    if (result?.mutated) {
      generateThumbnailForSession(id).catch(() => {});
    }
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

/**
 * Internal layout page used ONLY by the thumbnail generator. Renders all
 * session frames as same-origin iframes at their fit-all positions over a
 * grid background, so headless Chrome can screenshot it as a single PNG.
 * Reachable only from localhost (the headless browser runs on the server).
 * External requests get a 404 — this is not a public endpoint.
 */
async function handleThumbLayout(request, response, url) {
  if (!isLocalhostRequest(request)) throw new HttpError(404, "Endpoint tidak ditemukan");
  const match = url.pathname.match(/^\/__thumb_layout\/([0-9a-f-]{36})$/i);
  if (!match) throw new HttpError(404, "Endpoint tidak ditemukan");
  const [, id] = match;
  const session = await store.get(id);
  const { html } = buildLayoutHtml({
    id,
    frames: Array.isArray(session.frames) ? session.frames : [],
    port: config.port,
  });
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    // iframes must be allowed to load same-origin /preview/ URLs.
    "Content-Security-Policy": "default-src 'self'; frame-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
  });
  response.end(html);
}

function isLocalhostRequest(request) {
  const host = String(request.headers.host || "").toLowerCase();
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:") || host === "127.0.0.1" || host === "localhost";
}

/**
 * Best-effort thumbnail regeneration. Reads the session, renders a fit-all
 * PNG via headless Chrome, and caches it at data/sessions/<id>/thumb.png.
 * Swallows all errors (no Chrome, capture timeout, etc.) — callers may run
 * this fire-and-forget after a mutating AI turn.
 */
async function generateThumbnailForSession(id) {
  const session = await store.get(id);
  const frames = Array.isArray(session.frames) ? session.frames : [];
  if (frames.length === 0) {
    await store.removeThumbnail(id);
    return;
  }
  const buffer = await generateThumbnail({ id, frames, port: config.port });
  if (buffer) await store.writeThumbnail(id, buffer);
}

/**
 * Backfill thumbnail untuk session yang belum punya, dipicu saat portal diminta.
 * Idempotent: skip bila thumb sudah ada. Fire-and-forget, swallow semua error.
 * Menghindari regen berulang setiap GET /api/sessions.
 */
const backfillInFlight = new Set();
function backfillThumbnail(id) {
  if (backfillInFlight.has(id)) return Promise.resolve();
  const run = (async () => {
    try {
      const existing = await store.readThumbnail(id);
      if (existing) return; // sudah ada, jangan regen
      await generateThumbnailForSession(id);
    } catch {
      // best-effort: skip diam-diam (mis. Chrome tidak tersedia).
    } finally {
      backfillInFlight.delete(id);
    }
  })();
  backfillInFlight.add(id);
  return run;
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

// Auto cache-busting: a single asset version ID is generated when the server
// starts, and injected into every static asset reference (href/src/from) at
// serve time. Files with `?v=` are served as immutable (cached a year). When
// you restart the server, a new ID is generated → all URLs change → browsers
// refetch every asset automatically. No manual ?v=N bumping in HTML/JS.
const ASSET_VERSION_ID = randomBytes(6).toString("base64url");

// Matches absolute asset references inside HTML/JS: href="/x", src="/x",
// from "/x". Captures the bare path (no query). Only rewrites known public
// asset extensions so we never touch arbitrary URLs.
const ASSET_REF_RE = /((?:^|[\s"'(])(?:href|src|from)\s*=\s*["']|from\s*["'])(\/[A-Za-z0-9._\-\/]+?)(["'])/g;

function injectAssetVersions(content) {
  return content.replace(ASSET_REF_RE, (full, prefix, path, quote) => {
    if (path.includes("?") || path.includes("#")) return full; // already versioned
    if (!/\.(html?|css|js|mjs|json|svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(path)) return full;
    return `${prefix}${path}?v=${ASSET_VERSION_ID}${quote}`;
  });
}

async function servePublic(request, response, pathname) {
  // Strip ?v=<id> query — used only for cache-busting; the file is the same.
  // Presence of ?v= lets us serve the asset immutably.
  const urlObj = new URL(pathname, "http://localhost");
  const cleanPath = urlObj.pathname;
  const hasVersionQuery = urlObj.searchParams.has("v");
  const requested = cleanPath === "/" ? "index.html" : cleanPath.slice(1);
  let fullPath;
  let info;
  try {
    fullPath = await resolveWithin(publicDir, requested);
    info = await stat(fullPath);
    if (!info.isFile()) throw new Error("not-file");
  } catch {
    fullPath = join(publicDir, "index.html");
    info = await stat(fullPath);
  }
  let content = await readFile(fullPath);
  const ext = extname(fullPath).toLowerCase();
  const isHtml = ext === ".html";
  // Inject ?v=<id> into HTML and JS module references so the browser caches
  // each asset immutably and refetches automatically when the server restarts
  // (which generates a new ASSET_VERSION_ID).
  if (isHtml || ext === ".js" || ext === ".mjs") {
    content = Buffer.from(injectAssetVersions(content.toString("utf8")), "utf8");
  }
  // Cache strategy:
  //  - Asset with ?v=<id>: immutable, 1 year (ID changes on restart → refetch).
  //  - HTML (entry point): NEVER cache. HTML is the only place that carries
  //    the asset ?v= links, so it must always be fresh.
  //  - Other files without ?v= (rare direct access): revalidate via ETag.
  const etag = `"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  let cacheControl;
  if (hasVersionQuery) cacheControl = "public, max-age=31536000, immutable";
  else if (isHtml) cacheControl = "no-store";
  else cacheControl = "no-cache, must-revalidate";
  response.writeHead(200, {
    "Content-Type": mimeType(fullPath),
    "Cache-Control": cacheControl,
    "ETag": etag,
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

/**
 * Categorize an AI error for the admin log. Order matters: structured fields
 * set by DeepSeekClient (error.status / error.errorType) win first, then we
 * inspect error.name and message substrings as a fallback.
 */
function classifyError(error) {
  if (error?.errorType) return error.errorType; // "Server" | "HTTP" (set by deepseek.js)
  if (error?.status >= 500) return "Server";
  if (error?.status) return "HTTP";
  const name = error?.name || "";
  const msg = String(error?.message || "");
  if (name === "AbortError") return "AbortError";
  if (name === "TypeError") return "Network"; // fetch() failures (DNS, offline, timeout)
  if (/belum dikonfigurasi/i.test(msg)) return "Config";
  if (/mencapai batas .* iterasi/i.test(msg)) return "MaxIterations";
  return "Unknown";
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
