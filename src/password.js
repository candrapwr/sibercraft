import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

// Parameter scrypt. N=2^14 adalah default yang seimbang antara keamanan
// dan kinerja pada server lokal. Naikkan ke 2^15/2^16 bila perlu.
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_LEN = 16;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * Hash password plain-text menjadi format portable:
 *   scrypt$<salt_hex>$<hash_hex>
 */
export async function hashPassword(plain) {
  const salt = randomBytes(SCRYPT_SALT_LEN);
  const derived = await scrypt(String(plain), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verifikasi password terhadap hash tersimpan, konstan-waktu.
 * Mengembalikan true/false. Format tidak dikenal -> false (bukan throw)
 * agar tidak membocorkan apakah akun ada.
 */
export async function verifyPassword(plain, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (salt.length !== SCRYPT_SALT_LEN || expected.length !== SCRYPT_KEYLEN) return false;
  const derived = await scrypt(String(plain), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
