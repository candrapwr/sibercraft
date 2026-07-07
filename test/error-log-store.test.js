import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../src/db/db.js";
import { ErrorLogStore } from "../src/observability/error-log-store.js";

async function freshStore(t) {
  const dir = await mkdtemp(join(tmpdir(), "sibercraft-errorlog-"));
  const db = new DatabaseSync(join(dir, "app.db"));
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  const store = new ErrorLogStore(db);
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  return store;
}

test("log: menyimpan entry lengkap dan return id", async (t) => {
  const store = await freshStore(t);
  const id = store.log({
    sessionId: "sess-1", ownerId: "user-1", model: "deepseek-chat",
    providerSource: "user", mode: "primary",
    errorMessage: "Primary AI API 401: invalid api key",
    errorType: "HTTP", iteration: 0,
  });
  assert.match(String(id), /^[0-9a-f-]{36}$/);
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].model, "deepseek-chat");
  assert.equal(list[0].errorType, "HTTP");
  assert.equal(list[0].iteration, 0);
  assert.equal(list[0].providerSource, "user");
});

test("list: terurut dari terbaru ke terlama", async (t) => {
  const store = await freshStore(t);
  const a = store.log({ errorMessage: "first", errorType: "Unknown" });
  // small delay to ensure distinct timestamps (ISO second precision)
  await new Promise((r) => setTimeout(r, 1100));
  const b = store.log({ errorMessage: "second", errorType: "Unknown" });
  const list = store.list();
  assert.equal(list[0].id, b);
  assert.equal(list[1].id, a);
});

test("list + count: filter by model (substring)", async (t) => {
  const store = await freshStore(t);
  store.log({ model: "deepseek-chat", errorMessage: "e1", errorType: "HTTP" });
  store.log({ model: "gpt-4o", errorMessage: "e2", errorType: "HTTP" });
  store.log({ model: "deepseek-v4-flash", errorMessage: "e3", errorType: "Server" });
  const filtered = store.list({ model: "deepseek" });
  assert.equal(filtered.length, 2);
  assert.equal(store.count({ model: "deepseek" }), 2);
});

test("list + count: filter by ownerId (exact)", async (t) => {
  const store = await freshStore(t);
  store.log({ ownerId: "user-A", errorMessage: "e1", errorType: "Unknown" });
  store.log({ ownerId: "user-B", errorMessage: "e2", errorType: "Unknown" });
  store.log({ ownerId: "user-A", errorMessage: "e3", errorType: "Unknown" });
  assert.equal(store.list({ ownerId: "user-A" }).length, 2);
  assert.equal(store.count({ ownerId: "user-A" }), 2);
});

test("list + count: filter by errorType", async (t) => {
  const store = await freshStore(t);
  store.log({ errorMessage: "e1", errorType: "HTTP" });
  store.log({ errorMessage: "e2", errorType: "Network" });
  store.log({ errorMessage: "e3", errorType: "HTTP" });
  assert.equal(store.list({ errorType: "HTTP" }).length, 2);
  assert.equal(store.count({ errorType: "HTTP" }), 2);
});

test("list + count: filter by since (ISO date)", async (t) => {
  const store = await freshStore(t);
  store.log({ errorMessage: "old", errorType: "Unknown" });
  await new Promise((r) => setTimeout(r, 1100));
  const cutoff = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 1100));
  store.log({ errorMessage: "new", errorType: "Unknown" });
  assert.equal(store.list({ since: cutoff }).length, 1);
  assert.equal(store.count({ since: cutoff }), 1);
});

test("list: pagination limit + offset", async (t) => {
  const store = await freshStore(t);
  for (let i = 0; i < 5; i++) {
    store.log({ errorMessage: `e${i}`, errorType: "Unknown" });
    await new Promise((r) => setTimeout(r, 1050));
  }
  assert.equal(store.list({ limit: 2 }).length, 2);
  assert.equal(store.list({ limit: 2, offset: 0 }).length, 2);
  assert.equal(store.list({ limit: 2, offset: 4 }).length, 1, "last page partial");
  assert.equal(store.count(), 5);
});

test("list: clamp limit ke 1..200", async (t) => {
  const store = await freshStore(t);
  store.log({ errorMessage: "e", errorType: "Unknown" });
  assert.equal(store.list({ limit: 0 }).length, 1, "limit 0 → clamp ke 1");
  assert.equal(store.list({ limit: 10000 }).length, 1, "limit besar → clamp ke 200");
});

test("delete: hapus satu entry by id", async (t) => {
  const store = await freshStore(t);
  const id = store.log({ errorMessage: "to delete", errorType: "Unknown" });
  store.log({ errorMessage: "keep", errorType: "Unknown" });
  assert.equal(store.delete(id), true);
  assert.equal(store.delete("nonexistent"), false);
  assert.equal(store.count(), 1);
});

test("clearAll: hapus semua entry, return count", async (t) => {
  const store = await freshStore(t);
  store.log({ errorMessage: "e1", errorType: "Unknown" });
  store.log({ errorMessage: "e2", errorType: "Unknown" });
  store.log({ errorMessage: "e3", errorType: "Unknown" });
  const removed = store.clearAll();
  assert.equal(removed, 3);
  assert.equal(store.count(), 0);
});

test("log: field opsional bisa null/undefined (sessionId, ownerId, iteration)", async (t) => {
  const store = await freshStore(t);
  store.log({ errorMessage: "pre-loop failure", errorType: "Config" });
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].sessionId, null);
  assert.equal(list[0].ownerId, null);
  assert.equal(list[0].iteration, null);
});

test("log: error message panjang di-slice ke 2000 char", async (t) => {
  const store = await freshStore(t);
  const long = "x".repeat(5000);
  store.log({ errorMessage: long, errorType: "HTTP" });
  assert.equal(store.list()[0].errorMessage.length, 2000);
});

test("log: errorMessage null → fallback 'Unknown error'", async (t) => {
  const store = await freshStore(t);
  store.log({ errorType: "Unknown" });
  assert.equal(store.list()[0].errorMessage, "Unknown error");
});
