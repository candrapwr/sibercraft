import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  verifySessionToken,
  parseCookies,
  sessionCookieHeader,
  clearCookieHeader,
} from "../src/session-cookie.js";

const SECRET = "super-secret-key";

test("createSessionToken & verifySessionToken round-trip", () => {
  const token = createSessionToken({ uid: "user-123" }, SECRET, 7);
  const payload = verifySessionToken(token, SECRET);
  assert.equal(payload?.uid, "user-123");
  assert.equal(typeof payload?.exp, "number");
});

test("verifySessionToken menolak tanda tangan yang dimanipulasi", () => {
  const token = createSessionToken({ uid: "user-1" }, SECRET, 7);
  const tampered = token.slice(0, -2) + "xx";
  assert.equal(verifySessionToken(tampered, SECRET), null);
});

test("verifySessionToken menolak secret yang salah", () => {
  const token = createSessionToken({ uid: "user-1" }, SECRET, 7);
  assert.equal(verifySessionToken(token, "secret-lain"), null);
});

test("verifySessionToken menolak token kadaluarsa", () => {
  const token = createSessionToken({ uid: "user-1" }, SECRET, 0);
  // maxAgeDays=0 -> exp sekarang, jadi sudah kedaluwarsa.
  assert.equal(verifySessionToken(token, SECRET), null);
});

test("verifySessionToken menolak format tidak valid", () => {
  assert.equal(verifySessionToken("", SECRET), null);
  assert.equal(verifySessionToken("abc", SECRET), null);
  assert.equal(verifySessionToken("a.b.c", SECRET), null);
});

test("parseCookies membaca pasangan cookie", () => {
  const cookies = parseCookies("a=1; b=hello; sibercraft_session=token.abc");
  assert.deepEqual(cookies, { a: "1", b: "hello", sibercraft_session: "token.abc" });
});

test("parseCookies mengabaikan pasangan tanpa nilai", () => {
  const cookies = parseCookies("a=1; bogus; =empty; c=2");
  assert.deepEqual(cookies, { a: "1", c: "2" });
});

test("sessionCookieHeader menyertakan HttpOnly dan SameSite", () => {
  const header = sessionCookieHeader("sibercraft_session", "tok", DAY, false);
  assert.match(header, /^sibercraft_session=tok;/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Lax/);
  assert.doesNotMatch(header, /Secure/);
});

test("sessionCookieHeader menambahkan Secure saat isSecure", () => {
  const header = sessionCookieHeader("s", "tok", DAY, true);
  assert.match(header, /Secure/);
});

test("clearCookieHeader mengatur Max-Age=0", () => {
  const header = clearCookieHeader("s", false);
  assert.match(header, /^s=;/);
  assert.match(header, /Max-Age=0/);
});

const DAY = 24 * 60 * 60 * 1000;
