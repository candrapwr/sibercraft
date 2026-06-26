import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Cookie sesi bertanda (signed) tanpa server-side store.
 * Format token: base64url(payload).base64url(hmac)
 * Payload: { uid, iat, exp } dengan detik epoch.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export function createSessionToken({ uid }, secret, maxAgeDays = 7) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + maxAgeDays * 24 * 60 * 60;
  const payload = JSON.stringify({ uid, iat, exp });
  const payloadB64 = b64url(payload);
  const signature = sign(`${payloadB64}`, secret);
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  if (!timingSafeEqualStr(sign(payloadB64, secret), signature)) return null;
  let payload;
  try {
    payload = JSON.parse(unb64url(payloadB64));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  const { uid, iat, exp } = payload;
  if (typeof uid !== "string" || typeof exp !== "number") return null;
  if (Math.floor(Date.now() / 1000) >= exp) return null;
  return { uid, iat, exp };
}

export function parseCookies(header) {
  const cookies = {};
  const raw = String(header || "");
  for (const pair of raw.split(";")) {
    const index = pair.indexOf("=");
    if (index < 1) continue;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

/**
 * Membangun header Set-Cookie untuk sesi login.
 * isSecure=true menambahkan flag Secure (https).
 */
export function sessionCookieHeader(name, token, maxAgeMs, isSecure) {
  const flags = [
    `${name}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecure) flags.push("Secure");
  return flags.join("; ");
}

export function clearCookieHeader(name, isSecure) {
  const flags = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (isSecure) flags.push("Secure");
  return flags.join("; ");
}

export const DAY_MS_VALUE = DAY_MS;

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function b64url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function unb64url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}
