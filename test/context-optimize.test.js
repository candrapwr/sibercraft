import test from "node:test";
import assert from "node:assert/strict";
import { optimizeContext, renderSignature } from "../src/context-optimize.js";

test("renderSignature merangkum argumen tool tanpa payload besar", () => {
  assert.equal(
    renderSignature("write_file", JSON.stringify({ path: "src/app.js", content: "x".repeat(500) })),
    'write_file("src/app.js")',
  );
  assert.equal(
    renderSignature("read_file", JSON.stringify({ path: "src/app.js", offset: 10, limit: 80 })),
    'read_file("src/app.js", 10-80)',
  );
});

test("optimizeContext summary menyisakan jawaban akhir dan blok SUMMARY", () => {
  const messages = [
    { role: "system", content: "system" },
    { role: "user", content: "buat hero baru" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_1", function: { name: "read_file", arguments: JSON.stringify({ path: "index.html" }) } },
        { id: "call_2", function: { name: "write_file", arguments: JSON.stringify({ path: "styles.css", content: "body{}" }) } },
      ],
    },
    { role: "tool", tool_call_id: "call_1", name: "read_file", content: "<html></html>" },
    { role: "tool", tool_call_id: "call_2", name: "write_file", content: "OK" },
    { role: "assistant", content: "Hero sudah diperbarui." },
  ];

  const optimized = optimizeContext(messages, { enabled: true, mode: "summary" });
  assert.equal(optimized.stats.collapsedCount, 2);
  assert.equal(optimized.messages.length, 3);
  assert.match(optimized.messages[1].content, /\[SUMMARY\]/);
  assert.match(optimized.messages[1].content, /read_file\("index\.html"\)/);
  assert.match(optimized.messages[1].content, /write_file\("styles\.css"\)/);
  assert.equal(optimized.messages[2].content, "Hero sudah diperbarui.");
});
