import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/password.js";

test("hashPassword menghasilkan format scrypt$<salt>$<hash>", async () => {
  const hash = await hashPassword("rahasia123");
  assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
});

test("verifyPassword menerima password yang benar", async () => {
  const hash = await hashPassword("password-benar");
  assert.equal(await verifyPassword("password-benar", hash), true);
});

test("verifyPassword menolak password yang salah", async () => {
  const hash = await hashPassword("password-benar");
  assert.equal(await verifyPassword("password-salah", hash), false);
});

test("hash berbeda untuk password yang sama (salt acak)", async () => {
  const a = await hashPassword("sama");
  const b = await hashPassword("sama");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("sama", a), true);
  assert.equal(await verifyPassword("sama", b), true);
});

test("verifyPassword mengembalikan false untuk format tidak dikenal", async () => {
  assert.equal(await verifyPassword("x", ""), false);
  assert.equal(await verifyPassword("x", "bogus"), false);
  assert.equal(await verifyPassword("x", "bcrypt$abc$def"), false);
  assert.equal(await verifyPassword("x", "scrypt$zz$zz"), false);
});
