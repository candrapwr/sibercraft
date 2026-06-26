import test from "node:test";
import assert from "node:assert/strict";
import { buildMimeMessage, encodeHeaderValue } from "../src/mail.js";

test("buildMimeMessage mengandung header wajib MIME", () => {
  const mime = buildMimeMessage({
    fromAddress: "craft@idsiber.com",
    fromName: "Craft idSiber",
    to: "user@example.com",
    subject: "Verifikasi akun",
    text: "halo",
    html: "<p>halo</p>",
  });
  assert.match(mime, /MIME-Version: 1\.0/);
  assert.match(mime, /Content-Type: multipart\/alternative; boundary=/);
  assert.match(mime, /From: "Craft idSiber" <craft@idsiber\.com>/);
  assert.match(mime, /To: user@example\.com/);
  assert.match(mime, /Date: /);
  assert.match(mime, /Message-ID: </);
});

test("buildMimeMessage membuat bagian text dan html", () => {
  const mime = buildMimeMessage({
    fromAddress: "a@b.com",
    fromName: "",
    to: "x@y.com",
    subject: "subjek",
    text: "isi plain",
    html: "<b>isi html</b>",
  });
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime, /Content-Type: text\/html; charset=UTF-8/);
  // Kedua isi ter-encode base64 di dalam body.
  const plainB64 = escapeRegExp(Buffer.from("isi plain", "utf8").toString("base64"));
  const htmlB64 = escapeRegExp(Buffer.from("<b>isi html</b>", "utf8").toString("base64"));
  assert.match(mime, new RegExp(plainB64));
  assert.match(mime, new RegExp(htmlB64));
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("buildMimeMessage diakhiri boundary penutup", () => {
  const mime = buildMimeMessage({
    fromAddress: "a@b.com",
    fromName: "",
    to: "x@y.com",
    subject: "s",
    text: "t",
    html: "<i>h</i>",
  });
  assert.match(mime, /----=_sibercraft_[a-z0-9]+--\r?\n$/);
});

test("encodeHeaderValue meneruskan ASCII apa adanya", () => {
  assert.equal(encodeHeaderValue("Plain ASCII subject"), "Plain ASCII subject");
});

test("encodeHeaderValue meng-encode non-ASCII (RFC 2047)", () => {
  const encoded = encodeHeaderValue("Konfirmasi ✓ akun Anda");
  assert.match(encoded, /=\?UTF-8\?B\?/);
});
