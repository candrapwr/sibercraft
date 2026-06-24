import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureWebpageScreenshot, validatePublicWebUrl } from "../src/web-screenshot.js";

test("validasi screenshot hanya menerima URL web publik", async () => {
  await assert.rejects(validatePublicWebUrl("http://localhost:3000"), /lokal\/private/);
  await assert.rejects(validatePublicWebUrl("http://127.0.0.1"), /lokal\/private/);
  await assert.rejects(validatePublicWebUrl("file:///tmp/page.html"), /http atau https/);
  assert.equal(
    await validatePublicWebUrl("https://example.com/page", async () => [{ address: "93.184.216.34", family: 4 }]),
    "https://example.com/page",
  );
  await assert.rejects(
    validatePublicWebUrl("https://internal.example", async () => [{ address: "192.168.1.20", family: 4 }]),
    /lokal\/private/,
  );
});

test("capture website mengirim payload API dan menyimpan PNG di workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sibercraft-webshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  let request;

  const result = await captureWebpageScreenshot({
    workspaceDir: root,
    url: "https://93.184.216.34/reference",
    endpoint: "https://snap.idsiber.com/api/screenshot",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
    },
  });

  assert.equal(request.url, "https://snap.idsiber.com/api/screenshot");
  assert.deepEqual(JSON.parse(request.options.body), {
    url: "https://93.184.216.34/reference",
    json: false,
    compress: true,
    quality: 75,
  });
  assert.match(result.path, /^screenshots\/93-184-216-34-[0-9a-f]{8}\.png$/);
  assert.deepEqual(await readFile(join(root, result.path)), png);
  assert.match(result.dataUrl, /^data:image\/png;base64,/);
});

test("capture website menerima WebP dari API ketika compress aktif", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sibercraft-webshot-webp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const webp = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
    0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4,
  ]);

  const result = await captureWebpageScreenshot({
    workspaceDir: root,
    url: "https://93.184.216.34/reference",
    endpoint: "https://snap.idsiber.com/api/screenshot",
    fetchImpl: async () => new Response(webp, {
      status: 200,
      headers: { "Content-Type": "image/webp" },
    }),
  });

  assert.match(result.path, /\.webp$/);
  assert.equal(result.type, "image/webp");
  assert.match(result.dataUrl, /^data:image\/webp;base64,/);
  assert.deepEqual(await readFile(join(root, result.path)), webp);
});
