import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileTools } from "../src/workspace/file-tools.js";

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

test("grep tersedia di schema tools", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-schema-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = createFileTools(root);
  assert.equal(tools.schemas.some((item) => item.function.name === "grep"), true);
});

test("grep menemukan match lintas file dengan path:line format", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "css"));
  await writeFile(join(root, "index.html"), "<h1>Halo</h1>\n<div class=\"btn-primary\">OK</div>\n", "utf8");
  await writeFile(join(root, "css/styles.css"), ".btn-primary { color: red; }\n.btn-secondary { color: blue; }\n", "utf8");
  await writeFile(join(root, "app.js"), "const x = 'no-match';\n", "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "btn-primary" }));
  assert.equal(result.mutated, false);
  assert.match(result.result, /index\.html:2:.*btn-primary/);
  assert.match(result.result, /css\/styles\.css:1:.*btn-primary/);
  // app.js tidak match → tidak muncul
  assert.equal(result.result.includes("app.js"), false);
});

test("grep: regex pattern (function \\w+\\()", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-regex-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "app.js"), "function foo() {}\nconst bar = () => 1;\nfunction baz() {}\n", "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "function \\w+\\(" }));
  assert.match(result.result, /app\.js:1: function foo/);
  assert.match(result.result, /app\.js:3: function baz/);
  // arrow function tidak match pattern
  assert.equal(result.result.includes("bar"), false);
});

test("grep: case_insensitive=true", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-ci-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "a.txt"), "Hello World\nHELLO AGAIN\n", "utf8");
  const tools = createFileTools(root);

  const ci = await tools.execute("grep", JSON.stringify({ pattern: "hello", case_insensitive: true }));
  assert.match(ci.result, /a\.txt:1: Hello World/);
  assert.match(ci.result, /a\.txt:2: HELLO AGAIN/);

  const cs = await tools.execute("grep", JSON.stringify({ pattern: "hello", case_insensitive: false }));
  assert.match(cs.result, /tidak ada match/);
});

test("grep: tidak ada match → pesan informatif", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-none-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "a.txt"), "hello\n", "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "nonexistent-pattern-xyz" }));
  assert.match(result.result, /tidak ada match/);
});

test("grep: pattern regex tidak valid → error", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-badrx-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "[" }));
  assert.equal(result.mutated, false);
  assert.match(result.result, /^Error:/);
  assert.match(result.result, /regex tidak valid/i);
});

test("grep: dibatasi max_results", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  // 10 baris match
  await writeFile(join(root, "a.txt"), Array.from({ length: 10 }, () => "match").join("\n"), "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "match", max_results: 3 }));
  const lines = result.result.split("\n").filter((l) => l.includes(": match"));
  assert.equal(lines.length, 3, "harus dibatasi ke 3 hasil");
  assert.match(result.result, /dibatasi 3 hasil/);
});

test("grep: search di subdirectory via path param", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-subdir-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "css"), { recursive: true });
  await writeFile(join(root, "index.html"), "target-here\n", "utf8");
  await writeFile(join(root, "css/styles.css"), "target-here\n", "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "target", path: "css" }));
  assert.match(result.result, /styles\.css:1: target/);
  // index.html di luar scope css → tidak muncul
  assert.equal(result.result.includes("index.html"), false);
});

test("grep: skip file non-teks (png/json ekstensi filter)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-skip-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "a.txt"), "findme\n", "utf8");
  await writeFile(join(root, "logo.png"), "findme-binary-content", "utf8"); // .png bukan text ext
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "findme" }));
  assert.match(result.result, /a\.txt:1: findme/);
  // .png diskip
  assert.equal(result.result.includes("logo.png"), false);
});

test("grep: skip dotfiles dan dotdirs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-dot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git/config"), "findme\n", "utf8");
  await writeFile(join(root, ".env"), "findme\n", "utf8");
  await writeFile(join(root, "real.txt"), "findme\n", "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "findme" }));
  assert.match(result.result, /real\.txt:1: findme/);
  assert.equal(result.result.includes(".git"), false);
  assert.equal(result.result.includes(".env"), false);
});

test("grep: truncate baris sangat panjang", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "forma-tools-grep-long-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const longLine = "x".repeat(500);
  await writeFile(join(root, "min.js"), `${longLine}\n`, "utf8");
  const tools = createFileTools(root);

  const result = await tools.execute("grep", JSON.stringify({ pattern: "x" }));
  // Baris dipotong ke 300 char + ellipsis
  assert.match(result.result, /…\n?$/);
  assert.ok(result.result.length < 400, "hasil tidak boleh terlalu panjang");
});
