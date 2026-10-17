import test from "node:test";
import assert from "node:assert/strict";
import { foldKeptTurnsForBudget, optimizeContext, renderSignature } from "../src/ai/context-optimize.js";

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

test("summary membedakan tool sukses, gagal, dan tidak dijalankan", () => {
  const messages = [
    { role: "user", content: "edit halaman" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_ok", function: { name: "edit_file", arguments: JSON.stringify({ path: "index.html" }) } },
        { id: "call_missing", function: { name: "write_file", arguments: JSON.stringify({ path: "style.css" }) } },
      ],
    },
    { role: "tool", tool_call_id: "call_ok", name: "edit_file", content: "[TOOL_STATUS=FAILED] edit_file: Error: old_string tidak ditemukan" },
  ];

  const optimized = optimizeContext(messages, { enabled: true, mode: "summary" });
  assert.match(optimized.messages[0].content, /edit_file\("index\.html"\) → FAILED/);
  assert.match(optimized.messages[0].content, /write_file\("style\.css"\) → NOT_EXECUTED/);
});

test("jawaban assistant tanpa tool diberi penanda bahwa operasi belum terbukti", () => {
  const optimized = optimizeContext([
    { role: "user", content: "ubah file" },
    { role: "assistant", content: "Selesai." },
  ], { enabled: true, mode: "summary" });
  assert.match(optimized.messages[1].content, /^\[ASSISTANT_NO_TOOL_EVIDENCE\]/);
});

function turnFixture(userText, resultChars) {
  return [
    { role: "user", content: userText },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: `call_${userText}`, function: { name: "grep", arguments: JSON.stringify({ path: "index.html", pattern: "render" }) } },
      ],
    },
    { role: "tool", tool_call_id: `call_${userText}`, name: "grep", content: `[TOOL_STATUS=SUCCESS] grep: ${"x".repeat(resultChars)}` },
    { role: "assistant", content: "Sudah saya periksa." },
  ];
}

test("foldKeptTurnsForBudget: di bawah budget tidak mengubah apa pun", () => {
  const messages = [...turnFixture("turn satu", 100), ...turnFixture("turn dua", 100)];
  const folded = foldKeptTurnsForBudget(messages, { budgetChars: 10_000 });
  assert.equal(folded.messages, messages);
  assert.equal(folded.stats.charsSaved, 0);
});

test("foldKeptTurnsForBudget: turn lama di-fold jadi [SUMMARY], turn terakhir utuh", () => {
  const messages = [...turnFixture("turn satu", 5_000), ...turnFixture("turn dua", 200)];
  const folded = foldKeptTurnsForBudget(messages, { budgetChars: 3_000 });

  assert.ok(folded.stats.charsSaved > 0);
  assert.equal(folded.stats.foldedTurns, 1);
  // Turn satu jadi satu pesan user berisi digest, tanpa sisa pesan tool.
  const firstUser = folded.messages[0];
  assert.equal(firstUser.role, "user");
  assert.match(firstUser.content, /turn satu/);
  assert.match(firstUser.content, /\[SUMMARY\]\ngrep\("index\.html", "render"\) → SUCCESS/);
  assert.equal(folded.messages.filter((message) => message.role === "tool").length, 1,
    "hanya hasil tool turn terakhir yang tetap utuh");
  // Turn terakhir tidak disentuh.
  assert.deepEqual(folded.messages.at(-3), messages.at(-3));
  assert.deepEqual(folded.messages.at(-2), messages.at(-2));
  assert.deepEqual(folded.messages.at(-1), messages.at(-1));
});

test("foldKeptTurnsForBudget: turn terakhir raksasa hanya dilipat di bagian awal", () => {
  const rounds = [];
  for (let index = 0; index < 5; index++) {
    rounds.push(
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: `call_r${index}`, function: { name: "grep", arguments: JSON.stringify({ pattern: `p${index}` }) } },
        ],
      },
      { role: "tool", tool_call_id: `call_r${index}`, name: "grep", content: `[TOOL_STATUS=SUCCESS] grep: ${"y".repeat(4_000)}` },
    );
  }
  const messages = [{ role: "user", content: "perbaiki semua" }, ...rounds];
  const folded = foldKeptTurnsForBudget(messages, { budgetChars: 3_000, keepRecentRounds: 2 });

  const toolMessages = folded.messages.filter((message) => message.role === "tool");
  assert.equal(toolMessages.length, 2, "dua round terakhir dipertahankan");
  assert.match(folded.messages[0].content, /\[SUMMARY\]/);
  assert.match(folded.messages[0].content, /turn dihentikan|perbaiki semua/);
  // Protokol tool tetap valid: setiap assistant ber-tool_calls diikuti hasilnya.
  for (let index = 0; index < folded.messages.length; index++) {
    const message = folded.messages[index];
    if (message.role === "assistant" && message.tool_calls?.length) {
      assert.equal(folded.messages[index + 1]?.tool_call_id, message.tool_calls[0].id);
    }
  }
});

test("foldKeptTurnsForBudget: hasil tool pada round yang dipertahankan dipotong bila raksasa", () => {
  const rounds = [];
  for (let index = 0; index < 4; index++) {
    rounds.push(
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: `call_c${index}`, function: { name: "read_file", arguments: JSON.stringify({ path: "index.html" }) } },
        ],
      },
      { role: "tool", tool_call_id: `call_c${index}`, name: "read_file", content: "[TOOL_STATUS=SUCCESS] read_file: " + "z".repeat(50_000) },
    );
  }
  const messages = [{ role: "user", content: "baca semua" }, ...rounds];
  const folded = foldKeptTurnsForBudget(messages, { budgetChars: 1_000, keepRecentRounds: 1, maxToolResultChars: 5_000 });
  const keptTool = folded.messages.find((message) => message.role === "tool");
  assert.ok(keptTool.content.length < 10_000);
  assert.match(keptTool.content, /hasil dipotong/);
  assert.equal(folded.stats.clippedResults >= 1, true);
});
