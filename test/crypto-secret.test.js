import test from "node:test";
import assert from "node:assert/strict";
import { deriveKey, encryptSecret, decryptSecret, secretFingerprint } from "../src/auth/crypto-secret.js";

const SECRET = "super-secret-session-key";

test("deriveKey: mengembalikan CryptoKey yang bisa dipakai encrypt/decrypt", async () => {
  const key = await deriveKey(SECRET);
  assert.equal(typeof key.algorithm, "object");
  assert.equal(key.algorithm.name, "AES-GCM");
});

test("deriveKey: cache hit — instance sama untuk secret yang sama", async () => {
  const a = await deriveKey(SECRET);
  const b = await deriveKey(SECRET);
  assert.equal(a, b, "CryptoKey harus ter-cache (instance identik)");
});

test("deriveKey: secret berbeda → key berbeda", async () => {
  const a = await deriveKey(SECRET);
  const b = await deriveKey("another-different-secret-value");
  assert.notEqual(a, b);
});

test("deriveKey: melempar bila secret kosong", async () => {
  await assert.rejects(() => deriveKey(""));
  await assert.rejects(() => deriveKey(null));
});

test("round-trip: decrypt(encrypt(x)) === x untuk berbagai input", async () => {
  const key = await deriveKey(SECRET);
  for (const value of ["sk-abc123", "short", "x".repeat(5000), "ünïcödé-🔑-token", "{nested:json}"]) {
    const encrypted = await encryptSecret(value, key);
    const decrypted = await decryptSecret(encrypted, key);
    assert.equal(decrypted, value);
  }
});

test("ciphertext berbeda untuk plaintext yang sama (IV acak)", async () => {
  const key = await deriveKey(SECRET);
  const a = await encryptSecret("same-secret", key);
  const b = await encryptSecret("same-secret", key);
  assert.notEqual(a, b, "IV acak harus menghasilkan ciphertext berbeda");
});

test("ciphertext bukan plaintext (tidak mengandung nilai asli)", async () => {
  const key = await deriveKey(SECRET);
  const plaintext = "sk-super-secret-key-12345";
  const encrypted = await encryptSecret(plaintext, key);
  assert.ok(!encrypted.includes(plaintext), "ciphertext tidak boleh mengandung plaintext");
});

test("GCM menolak decrypt dengan key yang salah (auth tag gagal)", async () => {
  const keyA = await deriveKey(SECRET);
  const keyB = await deriveKey("a-totally-different-secret");
  const encrypted = await encryptSecret("secret-value", keyA);
  await assert.rejects(() => decryptSecret(encrypted, keyB));
});

test("GCM menolak ciphertext yang di-tamper", async () => {
  const key = await deriveKey(SECRET);
  const encrypted = await encryptSecret("secret-value", key);
  // Flip the last byte (inside the auth tag region) — must break authentication.
  const buf = Buffer.from(encrypted, "base64url");
  buf[buf.length - 1] ^= 0xff;
  const tampered = buf.toString("base64url");
  await assert.rejects(() => decryptSecret(tampered, key));
});

test("decryptSecret: menolak payload yang terlalu pendek", async () => {
  const key = await deriveKey(SECRET);
  for (const bad of ["", "a", "ab", "abc", "aaaaaaaa"]) {
    await assert.rejects(() => decryptSecret(bad, key));
  }
});

test("secretFingerprint: deterministik untuk secret yang sama", () => {
  const a = secretFingerprint(SECRET);
  const b = secretFingerprint(SECRET);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test("secretFingerprint: berbeda untuk secret berbeda", () => {
  const a = secretFingerprint(SECRET);
  const b = secretFingerprint("another-secret");
  assert.notEqual(a, b);
});
