import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestUserMessage, buildRuntimeVisualMessage, compactFinalResponse, extractWriteFileDraft, isConversationalPrompt, selectTurnAi, toModelMessage } from "../src/ai/agent.js";

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

test("rangkuman final dibatasi maksimal tiga kalimat dan enam puluh kata", () => {
  const compact = compactFinalResponse("Satu selesai. Dua selesai. Tiga selesai. Empat tidak boleh tampil.");
  assert.equal(compact, "Satu selesai. Dua selesai. Tiga selesai…");

  const long = compactFinalResponse(Array.from({ length: 80 }, (_, index) => `kata${index}`).join(" "));
  assert.equal(long.replace(/…$/, "").split(/\s+/).length, 60);
  assert.match(long, /…$/);
});

test("gambar hanya dimasukkan ke payload pada turn multimodal", () => {
  assert.deepEqual(buildRequestUserMessage("Turn teks", []), { role: "user", content: "Turn teks" });
  assert.deepEqual(buildRequestUserMessage("Lihat referensi", [{ dataUrl: "data:image/png;base64,AAAA" }]), {
    role: "user",
    content: [
      { type: "text", text: "Lihat referensi" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ],
  });
});

test("pemilihan AI kembali ke mode utama pada turn teks berikutnya", () => {
  const config = {
    apiKey: "primary-key", baseUrl: "https://primary.test", model: "primary-model",
    multimodal: { apiKey: "vision-key", baseUrl: "https://vision.test", model: "vision-model" },
  };
  assert.equal(selectTurnAi(config, {}, true).model, "vision-model");
  assert.equal(selectTurnAi(config, {}, true).mode, "multimodal");
  assert.equal(selectTurnAi(config, {}, false).model, "primary-model");
  assert.equal(selectTurnAi(config, {}, false).mode, "primary");
});

test("model provider pribadi (BYOK) menang atas session.model (regresi bug override)", () => {
  // Simulasi: session dibuat dengan model server default "deepseek-v4-flash",
  // lalu user mengaktifkan provider pribadi dengan model "deepseek-chat".
  // Sebelum fix: session.model menang → user masih pakai model server.
  // Setelah fix: config.model (override user) harus menang.
  const config = {
    apiKey: "user-key", baseUrl: "https://user.example.com", model: "deepseek-chat",
    _providerSource: "user",
    multimodal: { apiKey: "", baseUrl: "", model: "" },
  };
  const session = { model: "deepseek-v4-flash" };
  const ai = selectTurnAi(config, session, false);
  assert.equal(ai.model, "deepseek-chat", "model user harus menang atas session.model");
  assert.equal(ai.apiKey, "user-key", "apiKey user harus dipakai");
  assert.equal(ai.baseUrl, "https://user.example.com", "baseUrl user harus dipakai");
});

test("tanpa provider pribadi, session.model tetap dipakai (fallback)", () => {
  const config = {
    apiKey: "server-key", baseUrl: "https://server.example.com", model: "deepseek-v4-flash",
    multimodal: { apiKey: "", baseUrl: "", model: "" },
  };
  const session = { model: "gpt-4o" };
  assert.equal(selectTurnAi(config, session, false).model, "gpt-4o");
  // Tanpa session.model, fallback ke config default.
  assert.equal(selectTurnAi(config, {}, false).model, "deepseek-v4-flash");
});

test("model global provider menang atas session.model (regresi bug global override)", () => {
  // Admin set global provider dengan model "gpt-4o". Session dibuat dengan
  // model default "deepseek-v4-flash". Global harus menang, bukan session.model.
  // Sebelum fix: _providerSource "server" (global) tidak dianggap override →
  // session.model "deepseek-v4-flash" dipakai → error MODEL_NOT_FOUND.
  const config = {
    apiKey: "global-key", baseUrl: "https://api.openai.com/v1", model: "gpt-4o",
    _providerSource: "global",
    multimodal: { apiKey: "", baseUrl: "", model: "" },
  };
  const session = { model: "deepseek-v4-flash" };
  const ai = selectTurnAi(config, session, false);
  assert.equal(ai.model, "gpt-4o", "model global harus menang atas session.model");
  assert.equal(ai.apiKey, "global-key");
  assert.equal(ai.baseUrl, "https://api.openai.com/v1");
});

test(".env default (tanpa override): session.model dipakai", () => {
  // _providerSource "server" tanpa override global → session.model menang.
  // Ini bedanya dengan "global": .env default TIDAK override session.model.
  const config = {
    apiKey: "env-key", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-v4-flash",
    _providerSource: "server",
    multimodal: { apiKey: "", baseUrl: "", model: "" },
  };
  const session = { model: "deepseek-chat" };
  assert.equal(selectTurnAi(config, session, false).model, "deepseek-chat");
});

test("toModelMessage: assistant dengan tool call TANPA narasi → content null", () => {
  // Kasus model hanya kasih tool call, tidak ada narasi (content kosong).
  // Sebelum fix: content="" dikirim ulang → beberapa provider OpenAI-compatible reject.
  // Setelah fix: content di-set null agar request history tetap valid.
  const msg = toModelMessage({
    role: "assistant",
    content: "",
    tool_calls: [{ id: "call_1", type: "function", function: { name: "write_file", arguments: "{}" } }],
  });
  assert.equal(msg.role, "assistant");
  assert.equal(msg.content, null, "content kosong + tool_calls harus jadi null");
  assert.ok(msg.tool_calls?.length, "tool_calls harus dipertahankan");
});

test("toModelMessage: assistant dengan narasi + tool call → content dipertahankan", () => {
  const msg = toModelMessage({
    role: "assistant",
    content: "Saya akan membuat file dashboard.",
    tool_calls: [{ id: "call_1", type: "function", function: { name: "write_file", arguments: "{}" } }],
  });
  assert.equal(msg.content, "Saya akan membuat file dashboard.");
  assert.ok(msg.tool_calls?.length);
});

test("toModelMessage: assistant tanpa tool call → content apa adanya", () => {
  const msg = toModelMessage({ role: "assistant", content: "Selesai." });
  assert.equal(msg.content, "Selesai.");
  assert.equal(msg.tool_calls, undefined);
});

test("toModelMessage: tool result message tidak terpengaruh", () => {
  const msg = toModelMessage({
    role: "tool",
    tool_call_id: "call_1",
    name: "write_file",
    content: "Berhasil menulis 100 byte",
  });
  assert.equal(msg.role, "tool");
  assert.equal(msg.content, "Berhasil menulis 100 byte");
  assert.equal(msg.tool_call_id, "call_1");
  assert.equal(msg.name, "write_file");
});

test("toModelMessage: whitespace-only content + tool_calls juga jadi null", () => {
  // Model kadang kasih content berupa spasi/newline saja tanpa teks bermakna.
  const msg = toModelMessage({
    role: "assistant",
    content: "   \n  ",
    tool_calls: [{ id: "call_1", type: "function", function: { name: "list_dir", arguments: "{}" } }],
  });
  assert.equal(msg.content, null, "whitespace-only harus dianggap kosong");
});

test("screenshot hasil tool dibentuk sebagai visual context untuk iterasi berikutnya", () => {
  const message = buildRuntimeVisualMessage([{ dataUrl: "data:image/png;base64,AAAA" }]);
  assert.equal(message.role, "user");
  assert.match(message.content[0].text, /Screenshot website/);
  assert.deepEqual(message.content[1], {
    type: "image_url",
    image_url: { url: "data:image/png;base64,AAAA" },
  });
});
