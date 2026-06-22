import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore } from "../src/session-store.js";
import { resolveWithin } from "../src/path-sandbox.js";

test("session menyimpan workspace, history, dan undo secara terpisah", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-session-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new SessionStore(root);
  await store.init();

  const first = await store.create({ name: "Sesi pertama", template: "blank", model: "test-model" });
  const second = await store.create({ name: "Sesi kedua", template: "dashboard", model: "test-model" });
  assert.notEqual(first.id, second.id);
  assert.equal((await store.list()).length, 2);

  await store.saveHistory(first.id, [{ role: "user", content: "ubah halaman" }]);
  await store.createCheckpoint(first.id, 0);
  await writeFile(join(store.workspaceDir(first.id), "app.js"), "changed", "utf8");
  await store.undo(first.id);

  assert.equal(await readFile(join(store.workspaceDir(first.id), "app.js"), "utf8"), 'console.log("Workspace siap");\n');
  assert.deepEqual(await store.history(first.id), []);
  assert.match(await readFile(join(store.workspaceDir(second.id), "app.js"), "utf8"), /Dashboard siap/);

  const unused = await store.createCheckpoint(first.id, 0);
  await store.discardCheckpoint(first.id, unused);
  assert.equal(await store.checkpointCount(first.id), 0);
});

test("path sandbox menolak akses ke luar workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-sandbox-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(resolveWithin(root, "../secret.txt"), /di luar workspace/);
  assert.match(await resolveWithin(root, "assets/new.svg"), /\/assets\/new\.svg$/);
});
