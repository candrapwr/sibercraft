import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { zipFile, unzipFile } from "./zip.js";
import { secretFingerprint } from "../auth/crypto-secret.js";

export const BACKUP_FORMAT = "sibercraft-backup";
export const BACKUP_VERSION = 1;
const MANIFEST_PATH = "manifest.json";
const MAX_ARCHIVE_ENTRIES = 200_000;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Create a complete application backup. The database is snapshotted with
 * SQLite VACUUM INTO, while workspace/session files are copied byte-for-byte.
 * Encrypted provider keys remain encrypted and require the same SESSION_SECRET
 * when the archive is restored.
 */
export async function createBackupArchive({ dataDir, db, sessionSecret }) {
  const root = await realpath(dataDir);
  const tempDb = join(dirname(root), `.sibercraft-backup-${randomUUID()}.db`);
  try {
    const escaped = tempDb.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    const files = [];
    files.push(await buildFileRecord("data/app.db", await readFile(tempDb)));
    for (const path of await walkFiles(root)) {
      const rel = relative(root, path).replaceAll("\\", "/");
      if (rel === "app.db" || rel === "app.db-wal" || rel === "app.db-shm") continue;
      const data = await readFile(path);
      files.push(await buildFileRecord(`data/${rel}`, data));
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    const manifestFiles = files.map(({ data, ...metadata }) => metadata);
    const manifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      sessionSecretFingerprint: secretFingerprint(sessionSecret),
      files: manifestFiles,
    };
    const entries = [{ path: MANIFEST_PATH, data: JSON.stringify(manifest, null, 2) }];
    for (const file of files) entries.push({ path: file.path, data: file.data });
    return { buffer: zipFile(entries, { compress: true }), manifest };
  } finally {
    await rm(tempDb, { force: true }).catch(() => {});
  }
}

/**
 * Validate an uploaded archive and materialize it into a staging directory.
 * No live application data is changed by this function.
 */
export async function stageBackupArchive({ archive, dataDir, sessionSecret }) {
  const entries = unzipFile(archive, {
    maxEntries: MAX_ARCHIVE_ENTRIES,
    maxTotalBytes: MAX_ARCHIVE_BYTES,
  });
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const manifestEntry = byPath.get(MANIFEST_PATH);
  if (!manifestEntry) throw new Error("Backup tidak memiliki manifest.json");

  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.data.toString("utf8"));
  } catch {
    throw new Error("manifest.json tidak valid");
  }
  if (manifest?.format !== BACKUP_FORMAT || manifest?.version !== BACKUP_VERSION) {
    throw new Error("Format backup tidak didukung");
  }
  if (manifest.sessionSecretFingerprint !== secretFingerprint(sessionSecret)) {
    throw new Error("SESSION_SECRET berbeda; backup tidak dapat dipulihkan dengan aman");
  }
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Manifest backup kosong");
  if (!manifest.files.some((file) => file?.path === "data/app.db")) throw new Error("Backup tidak memiliki database aplikasi");

  const expected = new Set([MANIFEST_PATH]);
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !isDataPath(file.path)) throw new Error("Manifest memiliki path tidak aman");
    if (expected.has(file.path)) throw new Error(`File backup duplikat: ${file.path}`);
    expected.add(file.path);
    const entry = byPath.get(file.path);
    if (!entry) throw new Error(`File backup hilang: ${file.path}`);
    if (!Number.isSafeInteger(file.size) || file.size !== entry.data.length || file.size > MAX_SINGLE_FILE_BYTES) {
      throw new Error(`Ukuran file backup tidak valid: ${file.path}`);
    }
    const checksum = sha256(entry.data);
    if (checksum !== file.sha256) throw new Error(`Checksum backup tidak cocok: ${file.path}`);
  }
  if (byPath.size !== expected.size || [...byPath.keys()].some((path) => !expected.has(path))) {
    throw new Error("Arsip berisi file yang tidak tercatat di manifest");
  }

  const parent = dirname(resolve(dataDir));
  const stage = join(parent, `.sibercraft-restore-${randomUUID()}`);
  await mkdir(stage, { recursive: true });
  try {
    for (const file of manifest.files) {
      const target = resolveArchiveDataPath(stage, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, byPath.get(file.path).data, { flag: "wx" });
    }
    validateSQLite(join(stage, "app.db"));
    return { stage, manifest };
  } catch (error) {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Atomically replace the live data directory with a validated stage. The
 * caller must close the live SQLite connection before invoking this function.
 * If the swap fails, the previous directory is restored.
 */
export async function replaceDataDirectory({ dataDir, stage }) {
  const live = resolve(dataDir);
  const rollback = `${live}.rollback-${randomUUID()}`;
  let movedLive = false;
  try {
    await rename(live, rollback);
    movedLive = true;
    await rename(stage, live);
    await rm(rollback, { recursive: true, force: true });
  } catch (error) {
    if (movedLive) {
      await rm(live, { recursive: true, force: true }).catch(() => {});
      await rename(rollback, live).catch(() => {});
    }
    await rm(stage, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function buildFileRecord(path, data) {
  return { path, size: data.length, sha256: sha256(data), data };
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function isDataPath(path) {
  return path.startsWith("data/") && path.length > 5 && isSafeRelativePath(path.slice(5));
}

function isSafeRelativePath(path) {
  return !path.startsWith("/") && !/^[A-Za-z]:/.test(path)
    && path.split("/").every((part) => part && part !== "." && part !== "..");
}

function resolveArchiveDataPath(stage, archivePath) {
  const rel = archivePath.slice("data/".length);
  if (!isDataPath(archivePath)) throw new Error("Path backup tidak aman");
  return join(stage, rel);
}

async function walkFiles(root) {
  const result = [];
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
      else throw new Error(`Tipe file data tidak didukung: ${path}`);
    }
  }
  await visit(root);
  return result;
}

function validateSQLite(path) {
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const row = db.prepare("PRAGMA integrity_check").get();
    if (!row || Object.values(row)[0] !== "ok") throw new Error("Database backup gagal integrity_check");
  } finally {
    db?.close();
  }
}