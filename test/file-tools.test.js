import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
