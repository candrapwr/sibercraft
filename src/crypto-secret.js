// Symmetric encryption helper for user secrets (API keys) stored at rest.
//
// Uses AES-256-GCM via WebCrypto (globalThis.crypto.subtle), available in
// Node 20+ as a built-in (no external dependency). The key is derived from
// SESSION_SECRET with scrypt + a fixed app-level salt so the same secret
// always yields the same key (required to decrypt persisted API keys).
//
// Storage format for ciphertext: base64url(iv || ciphertext || authTag).
//   - iv:       12 random bytes per message (AES-GCM standard).
//   - ciphertext: same length as plaintext.
//   - authTag:   16 bytes; GCM detects tampering / wrong key on decrypt.
//
// secretFingerprint() returns a short HMAC derived from the same secret. It
// is stored alongside the encrypted config so we can detect when SESSION_SECRET
// has changed (e.g. ephemeral dev secret regenerated on restart): a fingerprint
// mismatch means the old ciphertext can no longer be decrypted and should be
// treated as missing rather than crashing.

import { createHmac, scryptSync } from "node:crypto";

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM nonce
const TAG_LEN = 16;
// Fixed app-level salt. Random per-encryption IV already gives us semantic
// security; the salt only needs to pin the key-derivation to this app so the
// same SESSION_SECRET maps to one stable key.
const SCRYPT_SALT = Buffer.from("sibercraft/v1/provider-secret", "utf8");
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const subtle = globalThis.crypto.subtle;

// scryptSync is CPU-heavy; cache the derived CryptoKey per secret string so
// repeated requests for the same user don't re-derive the key. In practice
// there is one SESSION_SECRET per server lifetime, so this stays tiny.
const keyCache = new Map();

/**
 * Derive a 256-bit AES-GCM CryptoKey from a passphrase (SESSION_SECRET).
 * The derived key is memoized per secret so repeated calls are cheap.
 * Resolves to a CryptoKey usable with encrypt/decrypt. Throws if the secret
 * is empty.
 */
export async function deriveKey(secret) {
  const passphrase = String(secret || "");
  if (!passphrase) throw new Error("deriveKey: secret tidak boleh kosong");
  const cached = keyCache.get(passphrase);
  if (cached) return cached;
  const raw = scryptSync(passphrase, SCRYPT_SALT, KEY_LEN, SCRYPT_PARAMS);
  const cryptoKey = await subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  keyCache.set(passphrase, cryptoKey);
  return cryptoKey;
}

/**
 * Encrypt a UTF-8 plaintext string. Returns base64url(iv || ciphertext || authTag).
 * Resolves to the encoded string.
 */
export async function encryptSecret(plaintext, cryptoKey) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_LEN));
  const data = new TextEncoder().encode(String(plaintext));
  const encrypted = new Uint8Array(await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: TAG_LEN * 8 },
    cryptoKey,
    data,
  ));
  return Buffer.concat([iv, encrypted]).toString("base64url");
}

/**
 * Decrypt a base64url(iv || ciphertext || authTag) payload back to a UTF-8
 * string. Throws if the payload is malformed or if GCM authentication fails
 * (wrong key / tampered ciphertext).
 */
export async function decryptSecret(payload, cryptoKey) {
  const buf = Buffer.from(String(payload || ""), "base64url");
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("decryptSecret: payload terlalu pendek");
  }
  const iv = buf.subarray(0, IV_LEN);
  const encrypted = buf.subarray(IV_LEN);
  const decrypted = await subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: TAG_LEN * 8 },
    cryptoKey,
    encrypted,
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Short stable fingerprint of the secret (16 hex chars). Persisted alongside
 * encrypted config to detect when SESSION_SECRET has rotated: a mismatch on
 * read means the ciphertext is undecryptable with the current secret.
 */
export function secretFingerprint(secret) {
  return createHmac("sha256", String(secret || ""))
    .update("sibercraft/fingerprint/v1")
    .digest("hex")
    .slice(0, 16);
}
