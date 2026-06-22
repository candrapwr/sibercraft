import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestUserMessage, compactFinalResponse, extractWriteFileDraft, isConversationalPrompt, selectTurnAi } from "../src/agent.js";

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
