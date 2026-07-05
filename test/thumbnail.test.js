import test from "node:test";
import assert from "node:assert/strict";
import { computeLayoutBox, buildLayoutHtml } from "../src/thumbnail.js";
import { frameDimensions, DEVICE_SIZE } from "../src/session-store.js";

test("frameDimensions mengembalikan ukuran pixel sesuai device", () => {
  assert.deepEqual(frameDimensions({ device: "desktop" }), DEVICE_SIZE.desktop);
  assert.deepEqual(frameDimensions({ device: "tablet" }), DEVICE_SIZE.tablet);
  assert.deepEqual(frameDimensions({ device: "mobile" }), DEVICE_SIZE.mobile);
  // device tidak dikenal / hilang → fallback desktop.
  assert.deepEqual(frameDimensions({ device: "unknown" }), DEVICE_SIZE.desktop);
  assert.deepEqual(frameDimensions({}), DEVICE_SIZE.desktop);
  assert.deepEqual(frameDimensions(null), DEVICE_SIZE.desktop);
});

test("computeLayoutBox mengembalikan null bila frames kosong", () => {
  assert.equal(computeLayoutBox([]), null);
  assert.equal(computeLayoutBox(null), null);
  assert.equal(computeLayoutBox(undefined), null);
});

test("computeLayoutBox menghitung bbox benar dari frames", () => {
  const frames = [
    { device: "desktop", x: 0, y: 0 },    // 1280x800, ends (1280,800)
    { device: "mobile", x: 1400, y: 100 }, // 390x844, ends (1790,944)
  ];
  const box = computeLayoutBox(frames);
  assert.equal(box.minX, 0);
  assert.equal(box.minY, 0);
  assert.equal(box.width, 1790); // max(1280,1790) - 0
  assert.equal(box.height, 944); // max(800,944) - 0
});

test("computeLayoutBox menangani posisi negatif / koordinat tergeser", () => {
  const frames = [
    { device: "desktop", x: -500, y: -200 }, // 1280x800, ends (780,600)
    { device: "tablet", x: 1000, y: 0 },     // 768x1024, ends (1768,1024)
  ];
  const box = computeLayoutBox(frames);
  assert.equal(box.minX, -500);
  assert.equal(box.minY, -200);
  assert.equal(box.width, 1768 - (-500)); // 2268
  assert.equal(box.height, 1024 - (-200)); // 1224
});

test("computeLayoutBox mensubstitusi x/y NaN dengan 0", () => {
  const frames = [{ device: "desktop", x: undefined, y: "abc" }];
  const box = computeLayoutBox(frames);
  assert.equal(box.minX, 0);
  assert.equal(box.minY, 0);
  assert.equal(box.width, 1280);
  assert.equal(box.height, 800);
});

test("buildLayoutHtml menghasilkan layout kosong bila frames kosong", () => {
  const { html, width, height } = buildLayoutHtml({ id: "x", frames: [], port: 3000 });
  assert.equal(width, 1);
  assert.equal(height, 1);
  assert.match(html, /<html/);
});

test("buildLayoutHtml menyertakan satu iframe per frame dengan posisi & ukuran benar", () => {
  const id = "42868384-0aa5-4993-8764-a08d6fa2272b";
  const frames = [
    { file: "index.html", device: "desktop", x: 0, y: 0 },
    { file: "login.html", device: "mobile", x: 1400, y: 100 },
  ];
  const { html, width } = buildLayoutHtml({ id, frames, port: 3000 });
  // Dua iframe.
  assert.equal((html.match(/<iframe/g) || []).length, 2);
  // Iframe pertama: origin = minX(0) - 40 = -40, jadi posisi = 0 - (-40) = 40.
  assert.match(html, /left:40px;top:40px;width:1280px;height:800px/);
  // Iframe kedua: posisi = 1400 - (-40) = 1440, y = 100 - (-40) = 140. Mobile 390x844.
  assert.match(html, /left:1440px;top:140px;width:390px;height:844px/);
  // Iframe src menunjuk ke /preview/:id/<file> via 127.0.0.1.
  assert.match(html, new RegExp(`http://127\\.0\\.0\\.1:3000/preview/${id}/index\\.html`));
  assert.match(html, /http:\/\/127\.0\.0\.1:3000\/preview\/.*\/login\.html/);
  // Width halaman dibatasi MAX_LAYOUT_WIDTH (2560) — di sini muat jadi 1790+80=1870.
  assert.ok(width > 0 && width <= 2560);
  // File dengan karakter quote di-escape (tidak membuka attr).
  const safe = buildLayoutHtml({
    id,
    frames: [{ file: 'evil".html', device: "desktop", x: 0, y: 0 }],
    port: 3000,
  }).html;
  assert.doesNotMatch(safe, /evil"\.html"/);
});

test("buildLayoutHtml membatasi width halaman ke MAX_LAYOUT_WIDTH", () => {
  // 5 frame desktop berjajar horizontal: total jauh melebihi 2560.
  const frames = Array.from({ length: 5 }, (_, i) => ({
    device: "desktop",
    x: i * 1400,
    y: 0,
  }));
  const { width } = buildLayoutHtml({ id: "x", frames, port: 3000 });
  assert.equal(width, 2560);
});
