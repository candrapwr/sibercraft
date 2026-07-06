import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../src/db.js";
import { ProviderStore } from "../src/provider-store.js";
import { deriveKey } from "../src/crypto-secret.js";

const SECRET = "test-session-secret-for-provider-store";

async function freshStore(t) {
  const dir = await mkdtemp(join(tmpdir(), "sibercraft-provider-"));
  const db = new DatabaseSync(join(dir, "app.db"));
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const cryptoKey = await deriveKey(SECRET);
  const store = new ProviderStore(db, cryptoKey, SECRET);
  // Provider tables reference users(id) via FK; insert a dummy user row so
  // writes don't hit the FK constraint.
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, email, role, tier, status, created_at, updated_at) VALUES (?, ?, 'user', 'free', 'active', ?, ?)")
    .run(USER_ID, "user@example.com", now, now);
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  return { store, db };
}

const USER_ID = "11111111-1111-1111-1111-111111111111";

test("get: user tanpa config → disabled + provider kosong", async (t) => {
  const { store } = await freshStore(t);
  const config = await store.get(USER_ID);
  assert.equal(config.enabled, false);
  assert.equal(config.primary.apiKey, "");
  assert.equal(config.multimodal.apiKey, "");
});

test("getRedacted: apiKey diganti hasKey boolean", async (t) => {
  const { store } = await freshStore(t);
  await store.save(USER_ID, {
    enabled: true,
    primary: { apiKey: "sk-secret-123", baseUrl: "https://api.example.com/v1", model: "gpt-x" },
  });
  const redacted = await store.getRedacted(USER_ID);
  assert.equal(redacted.enabled, true);
  assert.equal(redacted.primary.hasKey, true);
  assert.equal(redacted.primary.baseUrl, "https://api.example.com/v1");
  assert.equal(redacted.primary.model, "gpt-x");
  // Plaintext key tidak boleh muncul di hasil redacted.
  assert.equal(JSON.stringify(redacted).includes("sk-secret-123"), false);
});

test("save lalu get: round-trip menyimpan apiKey, baseUrl, model", async (t) => {
  const { store } = await freshStore(t);
  await store.save(USER_ID, {
    enabled: true,
    primary: { apiKey: "sk-primary-key", baseUrl: "https://primary.example.com", model: "model-a" },
    multimodal: { apiKey: "sk-mm-key", baseUrl: "https://mm.example.com", model: "model-mm" },
  });
  const config = await store.get(USER_ID);
  assert.equal(config.enabled, true);
  assert.equal(config.primary.apiKey, "sk-primary-key");
  assert.equal(config.primary.baseUrl, "https://primary.example.com");
  assert.equal(config.primary.model, "model-a");
  assert.equal(config.multimodal.apiKey, "sk-mm-key");
  assert.equal(config.multimodal.model, "model-mm");
});

test("DB column BUKAN plaintext — apiKey ter-encrypt", async (t) => {
  const { store, db } = await freshStore(t);
  await store.save(USER_ID, {
    enabled: true,
    primary: { apiKey: "sk-very-secret-key-XYZ", baseUrl: "", model: "" },
  });
  const row = db.prepare("SELECT config_blob FROM user_provider_config WHERE user_id = ?").get(USER_ID);
  assert.ok(row.config_blob);
  // Plaintext tidak boleh muncul di blob.
  assert.equal(row.config_blob.includes("sk-very-secret-key-XYZ"), false);
  // Blob harus terlihat seperti base64url ciphertext, bukan JSON.
  assert.equal(row.config_blob.includes('"apiKey"'), false);
});

test("keep-existing-key: apiKey kosong saat save → key lama dipertahankan", async (t) => {
  const { store } = await freshStore(t);
  await store.save(USER_ID, {
    enabled: true,
    primary: { apiKey: "sk-original", baseUrl: "https://old.example.com", model: "v1" },
  });
  // Edit baseUrl/model tanpa re-enter key.
  await store.save(USER_ID, {
    enabled: true,
    primary: { apiKey: "", baseUrl: "https://new.example.com", model: "v2" },
  });
  const config = await store.get(USER_ID);
  assert.equal(config.primary.apiKey, "sk-original", "key lama harus tetap ada");
  assert.equal(config.primary.baseUrl, "https://new.example.com");
  assert.equal(config.primary.model, "v2");
});

test("explicit clear: apiKey null menghapus key", async (t) => {
  const { store } = await freshStore(t);
  await store.save(USER_ID, { enabled: true, primary: { apiKey: "sk-original", baseUrl: "", model: "" } });
  await store.save(USER_ID, { enabled: true, primary: { apiKey: null } });
  const config = await store.get(USER_ID);
  assert.equal(config.primary.apiKey, "");
});

test("save dengan enabled=false → get mengembalikan enabled=false", async (t) => {
  const { store } = await freshStore(t);
  await store.save(USER_ID, { enabled: true, primary: { apiKey: "sk-x", baseUrl: "", model: "" } });
  await store.save(USER_ID, { enabled: false });
  const config = await store.get(USER_ID);
  assert.equal(config.enabled, false);
  // Config masih tersimpan (bisa di-enable ulang tanpa re-enter key).
  assert.equal(config.primary.apiKey, "sk-x");
});

test("clear: hapus config secara menyeluruh", async (t) => {
  const { store } = await freshStore(t);
  await store.save(USER_ID, { enabled: true, primary: { apiKey: "sk-x", baseUrl: "", model: "" } });
  await store.clear(USER_ID);
  const config = await store.get(USER_ID);
  assert.equal(config.enabled, false);
  assert.equal(config.primary.apiKey, "");
});

test("fingerprint mismatch (SESSION_SECRET berubah) → graceful disabled", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "sibercraft-provider-"));
  const db = new DatabaseSync(join(dir, "app.db"));
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });

  // Simpan dengan secret lama.
  const oldKey = await deriveKey("old-secret");
  const storeOld = new ProviderStore(db, oldKey, "old-secret");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, email, role, tier, status, created_at, updated_at) VALUES (?, ?, 'user', 'free', 'active', ?, ?)")
    .run(USER_ID, "user@example.com", now, now);
  await storeOld.save(USER_ID, { enabled: true, primary: { apiKey: "sk-old", baseUrl: "", model: "" } });

  // Baca dengan secret baru (simulasi restart dengan SESSION_SECRET berubah).
  const newKey = await deriveKey("new-secret");
  const storeNew = new ProviderStore(db, newKey, "new-secret");
  const config = await storeNew.get(USER_ID);
  assert.equal(config.enabled, false, "harus graceful disabled saat fingerprint tidak cocok");
  assert.equal(config.primary.apiKey, "");
});

test("getUsage: user tanpa data → zero usage", async (t) => {
  const { store } = await freshStore(t);
  const usage = store.getUsage(USER_ID);
  assert.equal(usage.totalPromptTokens, 0);
  assert.equal(usage.totalCompletionTokens, 0);
  assert.equal(usage.totalTurns, 0);
});

test("incrementUsage: akumulasi prompt + completion + turn", async (t) => {
  const { store } = await freshStore(t);
  store.incrementUsage(USER_ID, 100, 50);
  store.incrementUsage(USER_ID, 200, 75);
  const usage = store.getUsage(USER_ID);
  assert.equal(usage.totalPromptTokens, 300);
  assert.equal(usage.totalCompletionTokens, 125);
  assert.equal(usage.totalTurns, 2);
});

test("incrementUsage: no-op untuk input nol", async (t) => {
  const { store } = await freshStore(t);
  store.incrementUsage(USER_ID, 0, 0);
  const usage = store.getUsage(USER_ID);
  assert.equal(usage.totalTurns, 0);
});

test("incrementUsage: nilai negatif di-clamp ke 0", async (t) => {
  const { store } = await freshStore(t);
  store.incrementUsage(USER_ID, -100, -50);
  const usage = store.getUsage(USER_ID);
  assert.equal(usage.totalPromptTokens, 0);
  assert.equal(usage.totalCompletionTokens, 0);
});
