import { randomUUID } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, posix, relative } from "node:path";
import { resolveWithin } from "./path-sandbox.js";

const SESSION_ID = /^[0-9a-f-]{36}$/i;
const DEVICE_SIZES = new Set(["desktop", "tablet", "mobile"]);
const FRAME_DEDUPE_MIGRATION = "deduplicate-duplicate-frames-v1";
const FRAME_ARRANGE_MIGRATION = "arrange-duplicate-frame-positions-v1";
const FRAME_LAYOUT_COLS = 3;
const FRAME_LAYOUT_GAP_X = 140;
const FRAME_LAYOUT_GAP_Y = 80;
// Pixel dimensions per device label. Mirror of frontend DEVICE_SIZE (canvas.js).
// Used by the thumbnail layout builder to size frames server-side.
export const DEVICE_SIZE = {
  desktop: { w: 1280, h: 800 },
  tablet: { w: 768, h: 1024 },
  mobile: { w: 390, h: 844 },
};

/** Resolve a frame's pixel dimensions from its device label (fallback desktop). */
export function frameDimensions(frame) {
  return DEVICE_SIZE[frame?.device] || DEVICE_SIZE.desktop;
}

export class SessionStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.root = join(dataDir, "sessions");
  }

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  /**
   * One-time cleanup for sessions that contain multiple frames for the same
   * HTML file. Each changed session is backed up before its frame list changes.
   */
  async migrateDuplicateFramesOnce({ dryRun = false } = {}) {
    const migrationDir = join(this.dataDir, "migrations");
    const markerPath = join(migrationDir, `${FRAME_DEDUPE_MIGRATION}.json`);
    let previousReport = null;
    try {
      previousReport = JSON.parse(await readFile(markerPath, "utf8"));
      if (previousReport?.version !== FRAME_DEDUPE_MIGRATION) previousReport = null;
      if (!dryRun && previousReport) {
        return { ran: false, alreadyApplied: true, report: previousReport };
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    const backupDir = join(migrationDir, "backups", FRAME_DEDUPE_MIGRATION);
    const report = {
      version: FRAME_DEDUPE_MIGRATION,
      mode: dryRun ? "dry-run" : "apply",
      scannedAt: new Date().toISOString(),
      sessionsScanned: 0,
      sessionsWithDuplicates: 0,
      sessionsChanged: 0,
      duplicateFramesToRemove: 0,
      duplicateFramesRemoved: 0,
      duplicateGroups: [],
      previousDuplicateGroups: previousReport?.duplicateGroups || [],
      backupDir,
    };

    const entries = await readdir(this.root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue;

      let raw;
      let session;
      try {
        raw = await readFile(join(this.sessionDir(entry.name), "session.json"), "utf8");
        session = JSON.parse(raw);
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
        throw error;
      }
      report.sessionsScanned++;

      const frames = Array.isArray(session.frames) ? session.frames : [];
      const byFile = new Map();
      frames.forEach((frame, index) => {
        const file = normalizeFrameFile(frame?.file);
        if (!file) return;
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push({ frame, index });
      });

      const keepIndexes = new Set(frames.map((_, index) => index));
      for (const [file, group] of byFile) {
        if (group.length < 2) continue;
        const dated = group
          .map((item) => ({ ...item, timestamp: Date.parse(item.frame.createdAt || "") }))
          .filter((item) => Number.isFinite(item.timestamp))
          .sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
        const keeper = dated[0] || group[0];
        const removed = group.filter((item) => item.index !== keeper.index);
        for (const item of removed) keepIndexes.delete(item.index);
        report.duplicateGroups.push({
          sessionId: entry.name,
          file,
          keptFrameId: keeper.frame.id || null,
          removedFrameIds: removed.map((item) => item.frame.id || null),
        });
      }

      const nextFrames = frames.filter((_, index) => keepIndexes.has(index));
      if (nextFrames.length === frames.length) continue;
      const duplicateCount = frames.length - nextFrames.length;
      report.sessionsWithDuplicates++;
      report.duplicateFramesToRemove += duplicateCount;
      if (dryRun) continue;

      await mkdir(backupDir, { recursive: true });
      const backupPath = join(backupDir, `${entry.name}.session.json`);
      try {
        await writeFile(backupPath, raw, { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch (error) {
        // A previous interrupted run may already have saved the original file.
        if (error.code !== "EEXIST") throw error;
      }

      await this.update(entry.name, { frames: nextFrames }, { preserveUpdatedAt: true });
      report.sessionsChanged++;
      report.duplicateFramesRemoved += duplicateCount;
    }

    if (!dryRun) {
      report.appliedAt = new Date().toISOString();
      await mkdir(migrationDir, { recursive: true });
      await atomicJson(markerPath, report);
    }
    return { ran: true, report };
  }

  /** Arrange positions for sessions affected by duplicate-frame cleanup. */
  async arrangeDuplicateFramePositionsOnce({ sessionIds = [], dryRun = false, removeFrameIdsBySession = {} } = {}) {
    const migrationDir = join(this.dataDir, "migrations");
    const markerPath = join(migrationDir, `${FRAME_ARRANGE_MIGRATION}.json`);
    if (!dryRun) {
      try {
        const marker = JSON.parse(await readFile(markerPath, "utf8"));
        if (marker?.version === FRAME_ARRANGE_MIGRATION) {
          return { ran: false, alreadyApplied: true, report: marker };
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }

    const backupDir = join(migrationDir, "backups", FRAME_ARRANGE_MIGRATION);
    const report = {
      version: FRAME_ARRANGE_MIGRATION,
      mode: dryRun ? "dry-run" : "apply",
      scannedAt: new Date().toISOString(),
      sessionsScanned: 0,
      sessionsToArrange: 0,
      sessionsArranged: 0,
      framesToMove: 0,
      framesMoved: 0,
      positionChanges: [],
      backupDir,
    };
    const ids = [...new Set(sessionIds.filter((id) => SESSION_ID.test(String(id))))];

    for (const id of ids) {
      let raw;
      let session;
      try {
        raw = await readFile(join(this.sessionDir(id), "session.json"), "utf8");
        session = JSON.parse(raw);
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
        throw error;
      }
      report.sessionsScanned++;

      const frames = Array.isArray(session.frames) ? session.frames : [];
      const removeIds = new Set(removeFrameIdsBySession[id] || []);
      const framesToArrange = frames.filter((frame) => !removeIds.has(frame.id));
      const arranged = arrangeFramePositions(framesToArrange);
      const moved = arranged.filter((frame, index) => frame.x !== framesToArrange[index].x || frame.y !== framesToArrange[index].y);
      if (!moved.length) continue;

      report.sessionsToArrange++;
      report.framesToMove += moved.length;
      report.positionChanges.push({
        sessionId: id,
        frames: moved.map(({ id: frameId, file, x, y }) => ({ frameId: frameId || null, file, x, y })),
      });
      if (dryRun) continue;

      await mkdir(backupDir, { recursive: true });
      const backupPath = join(backupDir, `${id}.session.json`);
      try {
        await writeFile(backupPath, raw, { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }

      await this.update(id, { frames: arranged }, { preserveUpdatedAt: true });
      report.sessionsArranged++;
      report.framesMoved += moved.length;
    }

    if (!dryRun) {
      report.appliedAt = new Date().toISOString();
      await mkdir(migrationDir, { recursive: true });
      await atomicJson(markerPath, report);
    }
    return { ran: true, report };
  }

  /**
   * Daftar sesi yang terlihat oleh ownerId:
   * - Semua sesi publik (anon-* atau orphan/null) — galeri komunal.
   * - Sesi milik ownerId sendiri.
   * - isAdmin=true -> semua sesi.
   */
  async list(ownerId, { isAdmin = false } = {}) {
    const entries = await readdir(this.root, { withFileTypes: true });
    const sessions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        return await this.get(entry.name);
      } catch {
        return null;
      }
    }));
    return sessions
      .filter(Boolean)
      .filter((session) => isAdmin || isPublicOwner(session.ownerId) || session.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Hitung jumlah sesi yang dimiliki ownerId secara eksak (untuk limit create anon). */
  async countByOwner(ownerId) {
    if (!ownerId) return 0;
    const entries = await readdir(this.root, { withFileTypes: true });
    let count = 0;
    for (const entry of entries.filter((entry) => entry.isDirectory())) {
      try {
        const session = JSON.parse(await readFile(join(this.sessionDir(entry.name), "session.json"), "utf8"));
        if (session.ownerId === ownerId) count++;
      } catch {
        // Lewati sesi rusak.
      }
    }
    return count;
  }

  /**
   * Pindahkan semua sesi milik oldOwnerId menjadi milik newOwnerId (claim).
   * Mengembalikan jumlah sesi yang dipindahkan. Tulis ulang session.json atomik.
   */
  async claimSessions(oldOwnerId, newOwnerId) {
    if (!oldOwnerId || !newOwnerId || oldOwnerId === newOwnerId) return 0;
    const entries = await readdir(this.root, { withFileTypes: true });
    let claimed = 0;
    for (const entry of entries.filter((entry) => entry.isDirectory())) {
      const sessionPath = join(this.sessionDir(entry.name), "session.json");
      try {
        const session = JSON.parse(await readFile(sessionPath, "utf8"));
        if (session.ownerId === oldOwnerId) {
          session.ownerId = newOwnerId;
          session.updatedAt = new Date().toISOString();
          await atomicJson(sessionPath, session);
          claimed++;
        }
      } catch {
        // Lewati sesi yang rusak/tidak terbaca.
      }
    }
    return claimed;
  }

  /**
   * Hapus SEMUA sesi milik ownerId tertentu dari filesystem. Dipakai saat admin
   * menghapus user agar project miliknya ikut terhapus. Mengembalikan jumlah terhapus.
   */
  async removeByOwner(ownerId) {
    if (!ownerId) return 0;
    const entries = await readdir(this.root, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries.filter((entry) => entry.isDirectory())) {
      try {
        const session = JSON.parse(await readFile(join(this.sessionDir(entry.name), "session.json"), "utf8"));
        if (session.ownerId === ownerId) {
          await rm(this.sessionDir(entry.name), { recursive: true, force: true });
          removed++;
        }
      } catch {
        // Lewati sesi rusak.
      }
    }
    return removed;
  }

  async create({ name, template = "blank", model, ownerId = null }) {
    const cleanName = String(name || "").trim().slice(0, 80);
    if (!cleanName) throw new HttpError(400, "Nama sesi wajib diisi");
    if (!new Set(["blank", "dashboard"]).has(template)) throw new HttpError(400, "Template tidak valid");

    const id = randomUUID();
    const now = new Date().toISOString();
    const session = {
      id,
      name: cleanName,
      template,
      model,
      ownerId,
      status: "ready",
      frames: [],
      usage: {
        last: { promptTokens: 0, completionTokens: 0, contextSize: 0 },
        total: { promptTokens: 0, completionTokens: 0 },
      },
      createdAt: now,
      updatedAt: now,
      lastPrompt: "",
    };
    const sessionDir = this.sessionDir(id);
    const workspace = join(sessionDir, "workspace");
    await mkdir(workspace, { recursive: true });
    await mkdir(join(sessionDir, "checkpoints"), { recursive: true });
    // Workspace dimulai kosong — file dibuat oleh AI saat user mulai chat.
    await Promise.all([
      atomicJson(join(sessionDir, "session.json"), session),
      atomicJson(join(sessionDir, "messages.json"), []),
    ]);
    return session;
  }

  /**
   * Baca sesi untuk INSPEKSI (preview/history/files/export). Publik (anon/orphan)
   * bisa diakses semua orang; privat hanya pemilik/admin.
   */
  async getForView(id, access) {
    const session = await this.readSession(id);
    if (this.canView(session, access)) return session;
    throw new HttpError(404, "Sesi tidak ditemukan");
  }

  /**
   * Baca sesi untuk MUTASI (chat/edit/delete/undo). Hanya pemilik/admin.
   * Sesi publik milik anon lain / orphan -> 403 read-only.
   */
  async getForEdit(id, access) {
    const session = await this.readSession(id);
    if (this.canEdit(session, access)) return session;
    // Pesan berbeda: publik tapi read-only vs benar-benar tidak ada.
    if (this.canView(session, access)) throw new HttpError(403, "Project ini bersifat publik dan hanya bisa diedit pemiliknya");
    throw new HttpError(404, "Sesi tidak ditemukan");
  }

  async readSession(id) {
    this.assertId(id);
    try {
      return JSON.parse(await readFile(join(this.sessionDir(id), "session.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") throw new HttpError(404, "Sesi tidak ditemukan");
      throw error;
    }
  }

  /** Boleh melihat: publik, atau milik ownerId, atau admin. */
  canView(session, access) {
    if (!session) return false;
    if (access?.isAdmin) return true;
    if (isPublicOwner(session.ownerId)) return true;
    return Boolean(access?.ownerId && session.ownerId === access.ownerId);
  }

  /** Boleh mengedit: milik ownerId, atau admin. (Sesi anon/orphan hanya pemiliknya.) */
  canEdit(session, access) {
    if (!session) return false;
    if (access?.isAdmin) return true;
    // Orphan (null) tidak punya pemilik -> tidak bisa diedit siapa pun kecuali admin.
    if (!session.ownerId) return false;
    return Boolean(access?.ownerId && session.ownerId === access.ownerId);
  }

  /** Baca tanpa cek akses (internal use, mis. untuk update/remove/history). */
  async get(id) {
    return this.readSession(id);
  }

  async update(id, patch, { preserveUpdatedAt = false } = {}) {
    const current = await this.get(id);
    const next = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: preserveUpdatedAt ? current.updatedAt : new Date().toISOString(),
    };
    await atomicJson(join(this.sessionDir(id), "session.json"), next);
    return next;
  }

  /**
   * Tambah frame baru ke sesi. Frame = preview iframe yang pin ke satu file HTML di workspace.
   * Posisi (x,y) di-auto-assign; client bisa drag & memperbarui via updateFrame.
   */
  async addFrame(id, { file, device = "desktop" }, { preserveUpdatedAt = false } = {}) {
    const current = await this.get(id);
    const frames = Array.isArray(current.frames) ? [...current.frames] : [];
    const normalizedFile = normalizeFrameFile(file);
    const existing = frames.find((frame) => normalizeFrameFile(frame.file) === normalizedFile);
    if (existing) return { ...existing, reused: true };

    const frame = {
      id: randomUUID(),
      file: normalizedFile,
      device: DEVICE_SIZES.has(device) ? device : "desktop",
      x: 0,
      y: 0,
      createdAt: new Date().toISOString(),
    };
    frames.push(frame);
    await this.update(id, { frames }, { preserveUpdatedAt });
    return frame;
  }

  /** Perbarui field frame tertentu (x, y, device). */
  async updateFrame(id, frameId, patch) {
    const current = await this.get(id);
    const frames = Array.isArray(current.frames) ? current.frames : [];
    const idx = frames.findIndex((f) => f.id === frameId);
    if (idx < 0) throw new HttpError(404, "Frame tidak ditemukan");
    const currentFrame = frames[idx];
    const next = { ...currentFrame, ...patch };
    if (next.device && !DEVICE_SIZES.has(next.device)) next.device = "desktop";
    if (Object.keys(next).every((key) => next[key] === currentFrame[key])) return currentFrame;
    frames[idx] = next;
    await this.update(id, { frames });
    return next;
  }

  /** Hapus frame dari sesi (tidak menghapus file di workspace). */
  async removeFrame(id, frameId) {
    const current = await this.get(id);
    const frames = Array.isArray(current.frames) ? current.frames.filter((f) => f.id !== frameId) : [];
    await this.update(id, { frames });
    // Bila tidak ada frame tersisa, hapus thumbnail cache (sudah tidak relevan).
    if (frames.length === 0) await this.removeThumbnail(id).catch(() => {});
    return frames;
  }

  async remove(id) {
    await this.get(id);
    await rm(this.sessionDir(id), { recursive: true, force: true });
  }

  workspaceDir(id) {
    this.assertId(id);
    return join(this.sessionDir(id), "workspace");
  }

  async history(id) {
    await this.get(id);
    try {
      const value = JSON.parse(await readFile(join(this.sessionDir(id), "messages.json"), "utf8"));
      return Array.isArray(value) ? value : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async saveHistory(id, messages) {
    await atomicJson(join(this.sessionDir(id), "messages.json"), messages);
  }

  async saveOptimizedHistory(id, messages, meta = {}) {
    await atomicJson(join(this.sessionDir(id), "messages.optimized.json"), {
      _view: "optimized",
      _generatedAt: new Date().toISOString(),
      ...meta,
      messages,
    });
  }

  async appendLlmRequestLog(id, entry) {
    await this.get(id);
    const path = join(this.sessionDir(id), "llm-requests.ndjson");
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async createCheckpoint(id, historyLength) {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const destination = join(this.sessionDir(id), "checkpoints", stamp);
    await mkdir(destination, { recursive: true });
    await cp(this.workspaceDir(id), join(destination, "workspace"), { recursive: true });
    await atomicJson(join(destination, "meta.json"), { historyLength, createdAt: new Date().toISOString() });
    return stamp;
  }

  async discardCheckpoint(id, checkpoint) {
    if (!checkpoint || !/^[0-9]+-[0-9a-f]{8}$/i.test(checkpoint)) return;
    await rm(join(this.sessionDir(id), "checkpoints", checkpoint), { recursive: true, force: true });
  }

  async undo(id) {
    await this.get(id);
    const root = join(this.sessionDir(id), "checkpoints");
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    if (!entries.length) throw new HttpError(409, "Belum ada perubahan yang dapat di-undo");

    const checkpoint = join(root, entries[0]);
    const meta = JSON.parse(await readFile(join(checkpoint, "meta.json"), "utf8"));
    const workspace = this.workspaceDir(id);
    await rm(workspace, { recursive: true, force: true });
    await cp(join(checkpoint, "workspace"), workspace, { recursive: true });
    const history = await this.history(id);
    await this.saveHistory(id, history.slice(0, meta.historyLength));
    const session = await this.get(id);
    const contextSummary = session.contextSummary
      && session.contextSummary.upToIndex < meta.historyLength
      ? session.contextSummary
      : null;
    await rm(checkpoint, { recursive: true, force: true });
    await this.update(id, { status: "ready", contextSummary });
    return { restored: entries[0] };
  }

  async listFiles(id) {
    await this.get(id);
    const root = this.workspaceDir(id);
    const files = [];
    await walk(root, async (fullPath, info) => {
      files.push({ path: relative(root, fullPath).split("\\").join("/"), size: info.size });
    });
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readWorkspaceFile(id, path) {
    await this.get(id);
    const fullPath = await resolveWithin(this.workspaceDir(id), path);
    return readFile(fullPath, "utf8");
  }

  async writeWorkspaceFile(id, path, content) {
    await this.get(id);
    if (typeof content !== "string") throw new HttpError(400, "Content file tidak valid");
    if (content.length > 2_000_000) throw new HttpError(413, "File terlalu besar");
    const fullPath = await resolveWithin(this.workspaceDir(id), path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    await this.update(id, { status: "ready" });
  }

  async saveUploadedImage(id, { name, type, buffer }) {
    await this.get(id);
    const extension = ({
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/webp": ".webp",
      "image/gif": ".gif",
    })[type];
    if (!extension) throw new HttpError(400, "Format gambar tidak didukung");
    const base = String(name || "image").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
    const path = `uploads/${base}-${randomUUID().slice(0, 8)}${extension}`;
    const fullPath = await resolveWithin(this.workspaceDir(id), path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);
    return { name: String(name || `image${extension}`).slice(0, 120), type, path };
  }

  async saveUploadedFile(id, { name, type, buffer }) {
    await this.get(id);
    if (!Buffer.isBuffer(buffer)) throw new HttpError(400, "Isi file tidak valid");

    const displayName = String(name || "file")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 180) || "file";
    const rawExtension = extname(displayName).toLowerCase();
    const extension = rawExtension.replace(/[^.a-z0-9]/g, "").slice(0, 20);
    const stem = displayName
      .slice(0, displayName.length - rawExtension.length)
      .normalize("NFKD")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "file";
    const path = `uploads/${stem}-${randomUUID().slice(0, 8)}${extension}`;
    const safeType = String(type || "application/octet-stream").split(";")[0].trim();
    const contentType = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(safeType)
      ? safeType.slice(0, 120)
      : "application/octet-stream";
    const fullPath = await resolveWithin(this.workspaceDir(id), path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);
    return { name: displayName, type: contentType, path, size: buffer.length };
  }

  /** Lokasi file thumbnail cache (di luar workspace/ supaya tidak ikut export/listFiles). */
  thumbPath(id) {
    this.assertId(id);
    return join(this.sessionDir(id), "thumb.png");
  }

  /** Baca thumbnail cache. Return { buffer, mtimeMs } atau null bila belum ada. */
  async readThumbnail(id) {
    const path = this.thumbPath(id);
    try {
      const info = await stat(path);
      if (!info.isFile()) return null;
      const buffer = await readFile(path);
      return { buffer, mtimeMs: info.mtimeMs };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  /** Thumbnail cache version for URL cache-busting without reading its bytes. */
  async thumbnailVersion(id) {
    const path = this.thumbPath(id);
    try {
      const info = await stat(path);
      return info.isFile() ? info.mtimeMs : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  /** Tulis (overwrite) thumbnail cache. */
  async writeThumbnail(id, buffer) {
    await this.get(id);
    await mkdir(this.sessionDir(id), { recursive: true });
    await writeFile(this.thumbPath(id), buffer);
  }

  /** Hapus thumbnail cache bila ada (best-effort). */
  async removeThumbnail(id) {
    try {
      await rm(this.thumbPath(id), { force: true });
    } catch {
      // best-effort
    }
  }

  async checkpointCount(id) {
    try {
      const entries = await readdir(join(this.sessionDir(id), "checkpoints"), { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).length;
    } catch {
      return 0;
    }
  }

  sessionDir(id) {
    this.assertId(id);
    return join(this.root, id);
  }

  assertId(id) {
    if (!SESSION_ID.test(String(id))) throw new HttpError(400, "ID sesi tidak valid");
  }
}

async function walk(dir, onFile) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) await walk(fullPath, onFile);
    else if (entry.isFile()) await onFile(fullPath, await stat(fullPath));
  }
}

/** Owner anon (anon-*) atau orphan (null) -> sesi publik (galeri komunal). */
export function isPublicOwner(ownerId) {
  if (!ownerId) return true;
  return String(ownerId).startsWith("anon-");
}

function normalizeFrameFile(file) {
  const value = String(file ?? "").replace(/\\/g, "/");
  if (!value) return "";
  const normalized = posix.normalize(value);
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

function arrangeFramePositions(frames) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  return frames.map((frame, index) => {
    if (index > 0 && index % FRAME_LAYOUT_COLS === 0) {
      x = 0;
      y += rowHeight + FRAME_LAYOUT_GAP_Y;
      rowHeight = 0;
    }
    const size = frameDimensions(frame);
    const width = Number.isFinite(frame.w) && frame.w > 0 ? frame.w : size.w;
    const height = Number.isFinite(frame.h) && frame.h > 0 ? frame.h : size.h;
    const arranged = { ...frame, x, y };
    x += width + FRAME_LAYOUT_GAP_X;
    rowHeight = Math.max(rowHeight, height);
    return arranged;
  });
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
