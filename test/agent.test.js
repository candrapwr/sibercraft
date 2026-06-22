import test from "node:test";
import assert from "node:assert/strict";
import { extractWriteFileDraft, isConversationalPrompt } from "../src/agent.js";

test("sapaan sederhana diperlakukan sebagai percakapan tanpa file tools", () => {
  assert.equal(isConversationalPrompt("halo"), true);
  assert.equal(isConversationalPrompt("Hai!"), true);
  assert.equal(isConversationalPrompt("selamat pagi"), true);
  assert.equal(isConversationalPrompt("Buatkan landing page"), false);
  assert.equal(isConversationalPrompt("halo, ubah warna halaman"), false);
});

test("draft write_file dapat diekstrak dari argumen JSON yang belum selesai", () => {
  const draft = extractWriteFileDraft('{"path":"index.html","content":"<h1>Live</h1>\\n<p>Draft');
  assert.deepEqual(draft, {
    path: "index.html",
    content: "<h1>Live</h1>\n<p>Draft",
  });
  assert.equal(extractWriteFileDraft('{"path":"data.json","content":"{}"}'), null);
  assert.equal(extractWriteFileDraft('{"path":"../index.html","content":"x"}'), null);
});
