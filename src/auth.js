import { randomUUID } from "node:crypto";
import { HttpError } from "./session-store.js";
import {
  parseCookies,
  verifySessionToken,
} from "./session-cookie.js";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

// Cooldown sederhana in-memory (per email + per IP). Tidak persisten lintas restart.
const registerAttempts = new Map();
const loginAttempts = new Map();

/**
 * Membaca cookie sesi dari request, memverifikasi tanda tangan, dan
 * mengembalikan user aktif atau null. Tidak melempar error bila belum login.
 */
export async function resolveUser(request, { userStore, secret, cookieName }) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[cookieName];
  if (!token) return null;
  const payload = verifySessionToken(token, secret);
  if (!payload) return null;
  const user = await userStore.findById(payload.uid);
  if (!user || user.status !== "active") return null;
  return user;
}

/**
 * Membaca/membuat identitas anonim dari cookie anon. Bila cookie tidak ada,
 * generate UUID baru dan tandai untuk di-set di response. Mengembalikan
 * { ownerId, setCookie } di mana setCookie adalah header string atau null.
 */
export function resolveAnonymousOwner(request, { cookieName, maxAgeDays, isSecure }) {
  const cookies = parseCookies(request.headers.cookie);
  const existing = cookies[cookieName];
  if (existing && ANON_ID.test(existing)) {
    return { ownerId: existing, setCookie: null };
  }
  const ownerId = `anon-${randomUUID()}`;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const setCookie = anonCookieHeader(cookieName, ownerId, maxAgeMs, isSecure);
  return { ownerId, setCookie };
}

/**
 * Menentukan ownerId untuk request: bila user login -> user.id, bila anon ->
 * anon-id dari cookie (dan set cookie baru bila perlu). Mengembalikan
 * { ownerId, user, isAnon, anonSetCookie }.
 */
export async function resolveOwner(request, response, user, anonConfig) {
  if (user) return { ownerId: user.id, user, isAnon: false, anonSetCookie: null };
  const anon = resolveAnonymousOwner(request, anonConfig);
  if (anon.setCookie) response.setHeader("Set-Cookie", anon.setCookie);
  return { ownerId: anon.ownerId, user: null, isAnon: true, anonSetCookie: anon.setCookie };
}

const ANON_ID = /^anon-[0-9a-f-]{36}$/i;

function anonCookieHeader(name, token, maxAgeMs, isSecure) {
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

export function requireUser(user) {
  if (!user) throw new HttpError(401, "Anda harus login terlebih dahulu");
  return user;
}

export function requireAdmin(user) {
  requireUser(user);
  if (user.role !== "admin") throw new HttpError(403, "Akses khusus admin");
  return user;
}

export function isAdmin(user) {
  return Boolean(user && user.role === "admin");
}

/** True bila request datang via https, atau proxy tepercaya melaporkan https. */
export function isSecureRequest(request) {
  const forwarded = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  return request.socket?.encrypted || forwarded.includes("https");
}

function isLoopback(request) {
  const ip = request.socket?.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/** Validasi format email sederhana (RFC-ish). */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim()) && email.trim().length <= 254;
}

/**
 * Catat percobaan register. Melempar 429 bila email yang sama sudah mendaftar
 * terlalu sering dalam window.
 */
export function noteRegisterAttempt(email, request) {
  const key = `${normalizeKey(email)}`;
  prune(registerAttempts);
  const count = (registerAttempts.get(key) || 0) + 1;
  registerAttempts.set(key, count);
  if (count > 3) throw new HttpError(429, "Terlalu banyak percobaan daftar. Coba lagi nanti.");
}

export function noteLoginFailure(email, request) {
  const ip = request.socket?.remoteAddress || "unknown";
  const key = `${normalizeKey(email)}@${ip}`;
  prune(loginAttempts);
  const count = (loginAttempts.get(key) || 0) + 1;
  loginAttempts.set(key, count);
  if (count > MAX_ATTEMPTS) {
    throw new HttpError(429, "Terlalu banyak percobaan login. Coba lagi nanti.");
  }
}

export function clearLoginFailures(email, request) {
  const ip = request.socket?.remoteAddress || "unknown";
  loginAttempts.delete(`${normalizeKey(email)}@${ip}`);
}

function prune(map) {
  // Pembersihan opsional; map kecil untuk app lokal, jadi tidak perlu timestamp.
  if (map.size > 1000) map.clear();
}

function normalizeKey(email) {
  return String(email || "").trim().toLowerCase();
}
