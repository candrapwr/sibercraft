import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Membuka koneksi SQLite (data/app.db) dan menjalankan migrasi tabel.
 * Mengembalikan instance DatabaseSync siap pakai.
 */
export async function initDb(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const dbPath = join(dataDir, "app.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  return db;
}

/**
 * Migrasi idempoten. Tambah blok CREATE TABLE IF NOT EXISTS di sini
 * saat skema baru dibutuhkan.
 */
export function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role          TEXT NOT NULL DEFAULT 'user',
      tier          TEXT NOT NULL DEFAULT 'free',
      status        TEXT NOT NULL DEFAULT 'pending',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at    TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- User-supplied provider config (BYOK). config_blob holds AES-256-GCM
    -- encrypted JSON { primary:{apiKey,baseUrl,model}, multimodal:{...} }.
    -- key_fingerprint lets us detect SESSION_SECRET rotation so an undecryptable
    -- blob is treated as missing instead of crashing the request.
    CREATE TABLE IF NOT EXISTS user_provider_config (
      user_id         TEXT PRIMARY KEY,
      enabled         INTEGER NOT NULL DEFAULT 0,
      config_blob     TEXT,
      key_fingerprint TEXT,
      updated_at      TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Aggregate token usage per user, incremented ONLY when the user chats
    -- using their own private provider key (server-default usage is not billed
    -- here). One row per user, upserted per turn.
    CREATE TABLE IF NOT EXISTS user_token_usage (
      user_id                TEXT PRIMARY KEY,
      total_prompt_tokens     INTEGER NOT NULL DEFAULT 0,
      total_completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_turns             INTEGER NOT NULL DEFAULT 0,
      updated_at             TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_verification_tokens_user
      ON verification_tokens(user_id);
  `);
}
