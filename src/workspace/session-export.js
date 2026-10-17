// Full-session export/import as ONE shareable ZIP.
//
// Archive layout (version 2 — workspace files at the root so the zip doubles
// as a plain asset pack):
//   manifest.json   — format/version + sanitized session metadata (name,
//                     model, frames, contextSummary, usage, lastPrompt)
//   messages.json   — the full conversation history
//   <files...>      — every workspace file at the archive root (a workspace
//                     file literally named manifest.json / messages.json or
//                     living under screenshots/ is prefixed with workspace/)
//   screenshots/    — optional PNG capture per preview frame
//
// Version 1 archives (files under workspace/) import unchanged. Checkpoints,
// thumbnails, and request logs are excluded: they are derived/heavy, and the
// thumbnail regenerates on first render. Import always creates a FRESH
// session owned by the importing user — nothing from the archive (ids,
// ownership) is trusted verbatim.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { zipFile, unzipFile } from "./zip.js";
import { resolveWithin } from "./path-sandbox.js";

export const SESSION_EXPORT_FORMAT = "sibercraft-session";
export const SESSION_EXPORT_VERSION = 2;

const MAX_MESSAGES = 20_000;
const MAX_FRAMES = 60;
const MAX_WORKSPACE_FILES = 5_000;
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
const VALID_ROLES = new Set(["user", "assistant", "tool", "system"]);
const VALID_DEVICES = new Set(["desktop", "tablet", "mobile"]);

/** Build the one-and-only session archive: files + history + screenshots. */
export async function buildSessionExport({ store, session, messages, screenshots = [] }) {
  const entries = [
    {
      path: "manifest.json",
      data: JSON.stringify({
        format: SESSION_EXPORT_FORMAT,
        version: SESSION_EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        session: {
          name: session.name,
          template: session.template === "dashboard" ? "dashboard" : "blank",
          model: typeof session.model === "string" ? session.model : "",
          frames: Array.isArray(session.frames) ? session.frames : [],
          contextSummary: session.contextSummary ?? null,
          usage: session.usage ?? null,
          lastPrompt: typeof session.lastPrompt === "string" ? session.lastPrompt : "",
          createdAt: typeof session.createdAt === "string" ? session.createdAt : new Date().toISOString(),
        },
      }, null, 2),
    },
    {
      path: "messages.json",
      data: JSON.stringify(Array.isArray(messages) ? messages : []),
    },
  ];
  for (const shot of screenshots) {
    if (shot?.path && shot?.data) entries.push({ path: `screenshots/${shot.path}`, data: shot.data });
  }
  for await (const file of walkWorkspace(store.workspaceDir(session.id))) {
    // Files live at the archive root (asset-pack friendly). Reserved names
    // are pushed under workspace/ so nothing collides with the metadata.
    const reserved = file.rel === "manifest.json" || file.rel === "messages.json" || file.rel.startsWith("screenshots/");
    entries.push({ path: reserved ? `workspace/${file.rel}` : file.rel, data: await readFile(file.full) });
  }
  return zipFile(entries, { compress: true });
}

/**
 * Import a session archive as a NEW session owned by `ownerId`.
 * Every field from the archive is validated/sanitized before use; on any
 * failure the freshly created session directory is removed again.
 *
 * Archives without a manifest but with HTML files at the root (the assets
 * export from the "Assets" button, or any folder of html the user zipped)
 * are imported as a files-only project: workspace copied, frames created per
 * HTML file, chat history empty, `importedFrom: "assets"` flag set.
 */
export async function importSessionArchive({ buffer, store, ownerId, defaultModel = "", fallbackName = "" }) {
  // Unzip sekali di awal: semua validasi gagal SEBELUM sesi baru dibuat.
  const entries = unzipFile(buffer, {
    maxEntries: MAX_WORKSPACE_FILES + 8,
    maxTotalBytes: MAX_ARCHIVE_BYTES,
  });
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));

  let manifest = null;
  try {
    const parsed = JSON.parse(byPath.get("manifest.json")?.data.toString("utf8") ?? "");
    if (parsed && typeof parsed === "object") manifest = parsed;
  } catch {
    manifest = null;
  }
  if (!manifest || manifest.format !== SESSION_EXPORT_FORMAT) {
    if (isAssetsArchive(entries)) {
      return importAssetsEntries({ entries, store, ownerId, defaultModel, fallbackName });
    }
    throw new Error(manifest
      ? "Format arsip tidak dikenali (bukan export session SiberCraft)"
      : manifestMissingMessage(entries));
  }
  const raw = manifest.session && typeof manifest.session === "object" ? manifest.session : {};

  let messages = [];
  const messagesData = byPath.get("messages.json")?.data;
  if (messagesData) {
    try {
      messages = JSON.parse(messagesData.toString("utf8"));
    } catch {
      throw new Error("messages.json pada arsip tidak valid");
    }
    if (!Array.isArray(messages)) throw new Error("messages.json pada arsip tidak valid");
  }
  messages = messages
    .filter((message) => message && typeof message === "object" && VALID_ROLES.has(message.role))
    .slice(0, MAX_MESSAGES);

  const name = sanitizeName(raw.name);
  const model = typeof raw.model === "string" && raw.model.trim()
    ? raw.model.trim().slice(0, 100)
    : defaultModel;
  const frames = sanitizeFrames(raw.frames);

  const session = await store.create({
    name,
    template: raw.template === "dashboard" ? "dashboard" : "blank",
    model,
    ownerId,
  });
  try {
    await copyWorkspaceEntries(entries, store.workspaceDir(session.id));

    await store.saveHistory(session.id, messages);
    return await store.update(session.id, {
      frames,
      status: "ready",
      contextSummary: sanitizeSummary(raw.contextSummary, messages.length),
      usage: sanitizeUsage(raw.usage),
      ...(typeof raw.lastPrompt === "string" ? { lastPrompt: raw.lastPrompt.slice(0, 140) } : {}),
    });
  } catch (error) {
    // Jangan tinggalkan sesi setengah jadi di disk.
    await store.remove(session.id).catch(() => {});
    throw error;
  }
}

/**
 * Copy archive entries into a session workspace. Accepts both layouts:
 * v2 (files at the archive root) and v1 (files under workspace/). Metadata
 * and screenshots are never workspace content. Returns the written rel paths.
 */
async function copyWorkspaceEntries(entries, workspaceDir) {
  const written = [];
  for (const entry of entries) {
    if (entry.path === "manifest.json" || entry.path === "messages.json") continue;
    if (entry.path.startsWith("screenshots/") || entry.path.startsWith("__MACOSX/")) continue;
    const rel = entry.path.startsWith("workspace/") ? entry.path.slice("workspace/".length) : entry.path;
    if (!rel) continue;
    if (written.length >= MAX_WORKSPACE_FILES) throw new Error("Arsip berisi terlalu banyak file");
    const full = await resolveWithin(workspaceDir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, entry.data);
    written.push(rel);
  }
  return written;
}

async function* walkWorkspace(dir, root = dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkWorkspace(full, root);
    } else if (entry.isFile()) {
      yield { full, rel: relative(root, full).split("\\").join("/") };
    }
  }
}

function sanitizeName(value) {
  const clean = String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
  return clean || "Project import";
}

/**
 * Distinguish "wrong kind of zip" from "corrupt zip": an assets export
 * (tombol Export/Assets) has screenshots/ and html files at the archive root,
 * which is the most common mix-up when importing.
 */
function manifestMissingMessage(entries) {
  if (isAssetsArchive(entries)) {
    return "File ini export ASET (hasil tombol 'Assets'/'Export' di header canvas), bukan file session — history chat tidak ada di dalamnya. Untuk file yang bisa di-impor, buka project lalu klik tombol 'Session' di header canvas.";
  }
  return "Arsip bukan export session SiberCraft (manifest.json tidak ada / tidak valid)";
}

/** An assets-style archive: html files at the root or one folder deep. */
function isAssetsArchive(entries) {
  return entries.some((entry) => {
    if (entry.path.startsWith("screenshots/") || entry.path.startsWith("__MACOSX/")) return false;
    return entry.path.split("/").length <= 2 && /\.html?$/i.test(entry.path);
  });
}

/** Import an assets-style zip as a files-only project (no chat history). */
async function importAssetsEntries({ entries, store, ownerId, defaultModel, fallbackName }) {
  const session = await store.create({
    name: sanitizeName(fallbackName),
    template: "blank",
    model: defaultModel,
    ownerId,
  });
  try {
    const written = await copyWorkspaceEntries(entries, store.workspaceDir(session.id));
    const htmlFiles = written.filter((rel) => /\.html?$/i.test(rel));
    for (const file of htmlFiles.slice(0, MAX_FRAMES)) {
      await store.addFrame(session.id, { file, device: "desktop" }, { preserveUpdatedAt: true });
    }
    return await store.update(session.id, { status: "ready", importedFrom: "assets" });
  } catch (error) {
    await store.remove(session.id).catch(() => {});
    throw error;
  }
}

function sanitizeFrames(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const frames = [];
  for (const frame of value) {
    if (!frame || typeof frame !== "object" || frames.length >= MAX_FRAMES) continue;
    const file = typeof frame.file === "string" ? frame.file.replace(/\\/g, "/").replace(/^\.?\//, "") : "";
    if (!file || file.split("/").includes("..") || !/\.html?$/i.test(file)) continue;
    let id = typeof frame.id === "string" && /^[\w-]{8,100}$/.test(frame.id) ? frame.id : randomUUID();
    while (seen.has(id)) id = randomUUID();
    seen.add(id);
    // Server frames do not store w/h by default (the canvas derives size
    // from the device) — never invent dimensions, or a mobile frame comes
    // back rendered at desktop size. Only carry over what actually exists.
    frames.push({
      id,
      file,
      device: VALID_DEVICES.has(frame.device) ? frame.device : "desktop",
      x: clampNumber(frame.x, -100_000, 100_000, 0),
      y: clampNumber(frame.y, -100_000, 100_000, 0),
      ...(Number.isFinite(frame.w) ? { w: clampNumber(frame.w, 200, 4_000, 1280) } : {}),
      ...(Number.isFinite(frame.h) ? { h: clampNumber(frame.h, 200, 8_000, 800) } : {}),
    });
  }
  return frames;
}

function sanitizeSummary(value, messageCount) {
  if (!value || typeof value !== "object") return null;
  const text = typeof value.text === "string" ? value.text.slice(0, 20_000) : "";
  const upToIndex = Number.isInteger(value.upToIndex) ? value.upToIndex : -1;
  if (!text.trim() || upToIndex < 0 || upToIndex >= Math.max(messageCount, 1)) return null;
  return {
    text,
    upToIndex,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

function sanitizeUsage(value) {
  const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(v, Number.MAX_SAFE_INTEGER) : 0);
  return {
    last: {
      promptTokens: num(value?.last?.promptTokens),
      completionTokens: num(value?.last?.completionTokens),
      contextSize: num(value?.last?.contextSize),
    },
    total: {
      promptTokens: num(value?.total?.promptTokens),
      completionTokens: num(value?.total?.completionTokens),
    },
  };
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.min(max, Math.max(min, num)) : fallback;
}
