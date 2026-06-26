import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../src/db.js";
import { UserStore, normalizeEmail } from "../src/auth-store.js";

async function freshStore() {
  const dir = await mkdtemp(join(tmpdir(), "sibercraft-auth-"));
  const db = new DatabaseSync(join(dir, "app.db"));
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);
  return { store: new UserStore(db), dir, db };
}

test("createPending menyimpan user pending dengan role/tier default", async (t) => {
  const { store, dir, db } = await freshStore();
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const user = await store.createPending({ email: "User@Example.com" });
  assert.equal(user.email, "user@example.com");
  assert.equal(user.role, "user");
  assert.equal(user.tier, "free");
  assert.equal(user.status, "pending");
  assert.equal(user.passwordHash, null);
});

test("createPending memberi role admin bila diminta eksplisit", async (t) => {
  const { store, dir, db } = await freshStore();
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const user = await store.createPending({ email: "admin@x.com", role: "admin" });
  assert.equal(user.role, "admin");
});

test("createPending menolak email duplikat", async (t) => {
  const { store, dir, db } = await freshStore();
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  await store.createPending({ email: "dup@x.com" });
  await assert.rejects(() => store.createPending({ email: "DUP@x.com" }), /sudah terdaftar/);
});

test("setPassword mengaktifkan akun dan menyimpan hash", async (t) => {
  const { store, dir, db } = await freshStore();
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const user = await store.createPending({ email: "a@x.com" });
  const updated = await store.setPassword(user.id, "scrypt$salt$hash");
  assert.equal(updated.status, "active");
  assert.equal(updated.passwordHash, "scrypt$salt$hash");
});

test("issueVerificationToken & consumeVerificationToken valid", async (t) => {
  const { store, dir, db } = await freshStore();
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const user = await store.createPending({ email: "b@x.com" });
  const future = new Date(Date.now() + 3600_000).toISOString();
  const token = await store.issueVerificationToken(user.id, future);
  assert.ok(typeof token === "string" && token.length === 64);

  const result = await store.consumeVerificationToken(token);
  assert.equal(result?.userId, user.id);

  // single-use: token kedua konsumsi gagal
  assert.equal(await store.consumeVerificationToken(token), null);
});

test("consumeVerificationToken menolak token kadaluarsa", async (t) => {
  const { store, dir, db } = await freshStore();
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const user = await store.createPending({ email: "c@x.com" });
  const past = new Date(Date.now() - 1000).toISOString();
  const token = await store.issueVerificationToken(user.id, past);
  assert.equal(await store.consumeVerificationToken(token), null);
});

test("consumeVerificationToken menolak token tidak dikenal", async (t) => {
  const { store, dir, db } = await freshStore();
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  assert.equal(await store.consumeVerificationToken("bogus"), null);
});

test("updateUser mengubah role dan tier", async (t) => {
  const { store, dir, db } = await freshStore();
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  const user = await store.createPending({ email: "d@x.com" });
  const updated = await store.updateUser(user.id, { role: "admin", tier: "tier2" });
  assert.equal(updated.role, "admin");
  assert.equal(updated.tier, "tier2");
});

test("normalizeEmail menyeragamkan format", () => {
  assert.equal(normalizeEmail("  Foo@BAR.com "), "foo@bar.com");
  assert.equal(normalizeEmail(""), "");
});
