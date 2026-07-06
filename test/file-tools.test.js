import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileTools } from "../src/file-tools.js";

test("file tools menulis dan mengedit file serta melaporkan mutation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "index.html"), "<h1>Lama</h1>", "utf8");
  const mutations = [];
  const tools = createFileTools(root, async (path) => mutations.push(path));

  const edited = await tools.execute("edit_file", JSON.stringify({
    path: "index.html", old_string: "Lama", new_string: "Baru",
  }));
  assert.equal(edited.mutated, true);
  assert.equal(await readFile(join(root, "index.html"), "utf8"), "<h1>Baru</h1>");
  assert.deepEqual(mutations, ["index.html"]);

  const escaped = await tools.execute("write_file", JSON.stringify({ path: "../escape.txt", content: "no" }));
  assert.match(escaped.result, /^Error:/);
  assert.equal(escaped.mutated, false);
});

test("tool screenshot hanya tersedia ketika integrasi visual diaktifkan", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-webshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const disabled = createFileTools(root);
  assert.equal(disabled.schemas.some((item) => item.function.name === "capture_webpage_screenshot"), false);

  const enabled = createFileTools(root, () => {}, {
    webScreenshot: { enabled: true, endpoint: "https://snap.idsiber.com/api/screenshot" },
  });
  assert.equal(enabled.schemas.some((item) => item.function.name === "capture_webpage_screenshot"), true);
});

test("tool delete_frame tersedia ketika callback diaktifkan", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-frame-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const calls = [];
  const tools = createFileTools(root, () => {}, {
    onDeleteFrame: async (input) => {
      calls.push(input);
      return {
        removed: { id: "frame-1", file: input.file },
        frames: [],
      };
    },
  });

  assert.equal(tools.schemas.some((item) => item.function.name === "delete_frame"), true);

  const deleted = await tools.execute("delete_frame", JSON.stringify({ file: "index.html" }));
  assert.equal(deleted.mutated, true);
  assert.deepEqual(calls, [{ frameId: undefined, file: "index.html" }]);
  assert.deepEqual(deleted.frames, []);
  assert.match(deleted.result, /Frame dihapus untuk index\.html/);
});

test("delete_file menghapus file dan melaporkan mutation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-delete-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "old.html"), "<h1>bye</h1>", "utf8");
  const mutations = [];
  const tools = createFileTools(root, async (path) => mutations.push(path));

  const result = await tools.execute("delete_file", JSON.stringify({ path: "old.html" }));
  assert.equal(result.mutated, true);
  assert.match(result.result, /Berhasil menghapus old\.html/);
  // Pesan memakai path yang diberikan user, bukan path absolut yang di-resolve.
  await assert.rejects(() => stat(join(root, "old.html")), { code: "ENOENT" });
  assert.deepEqual(mutations, ["old.html"]);
});

test("delete_file menolak menghapus direktori tanpa recursive=true", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-deldir-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "logo.svg"), "<svg/>", "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("delete_file", JSON.stringify({ path: "assets" }));
  assert.equal(result.mutated, false);
  assert.match(result.result, /^Error:/);
  assert.match(result.result, /recursive=true/);
  // Direktori masih ada.
  const info = await stat(join(root, "assets"));
  assert.equal(info.isDirectory(), true);
});

test("delete_file menghapus direktori recursive=true", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-delrec-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets/nested"), { recursive: true });
  await writeFile(join(root, "assets", "logo.svg"), "<svg/>", "utf8");
  await writeFile(join(root, "assets/nested", "deep.css"), "body{}", "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("delete_file", JSON.stringify({ path: "assets", recursive: true }));
  assert.equal(result.mutated, true);
  assert.match(result.result, /Berhasil menghapus direktori assets/);
  await assert.rejects(() => stat(join(root, "assets")), { code: "ENOENT" });
});

test("delete_file error bila file tidak ada", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-delmissing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = createFileTools(root);

  const result = await tools.execute("delete_file", JSON.stringify({ path: "nope.html" }));
  assert.equal(result.mutated, false);
  assert.match(result.result, /^Error:/);
});

test("delete_file menolak path di luar workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-delescape-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "inside.txt"), "ok", "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("delete_file", JSON.stringify({ path: "../escape.txt" }));
  assert.equal(result.mutated, false);
  assert.match(result.result, /^Error:/);
  // File di dalam tetap utuh.
  await stat(join(root, "inside.txt"));
});

test("delete_file tersedia di schema tools", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-schema-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = createFileTools(root);
  assert.equal(tools.schemas.some((item) => item.function.name === "delete_file"), true);
});
