import { randomUUID, createHash, randomBytes } from "node:crypto";

/**
 * UserStore: akses data user & token verifikasi via SQLite (DatabaseSync).
 * Method async agar kontraknya konsisten dengan SessionStore.
 */
export class UserStore {
  constructor(db) {
    this.db = db;
    this.stmt = {
      findByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
      findById: db.prepare("SELECT * FROM users WHERE id = ?"),
      insertUser: db.prepare(`
        INSERT INTO users (id, email, password_hash, role, tier, status, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, 'pending', ?, ?)
      `),
      setPassword: db.prepare(`
        UPDATE users SET password_hash = ?, status = 'active', updated_at = ?
        WHERE id = ?
      `),
      updateMeta: db.prepare(`
        UPDATE users SET role = COALESCE(?, role), tier = COALESCE(?, tier), updated_at = ?
        WHERE id = ?
      `),
      deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
      activateUser: db.prepare("UPDATE users SET status = 'active', updated_at = ? WHERE id = ?"),
      listUsers: db.prepare("SELECT * FROM users ORDER BY created_at ASC"),
      insertToken: db.prepare(`
        INSERT INTO verification_tokens (token_hash, user_id, expires_at, used_at, created_at)
        VALUES (?, ?, ?, NULL, ?)
      `),
      findToken: db.prepare("SELECT * FROM verification_tokens WHERE token_hash = ?"),
      consumeToken: db.prepare(`
        UPDATE verification_tokens SET used_at = ? WHERE token_hash = ?
      `),
    };
  }

  async findByEmail(email) {
    return row(this.stmt.findByEmail.get(normalizeEmail(email))) || null;
  }

  async findById(id) {
    return row(this.stmt.findById.get(String(id || ""))) || null;
  }

  /**
   * Membuat user pending (belum ada password). Email harus unik.
   * Role default "user" kecuali adminEmails berisi email ini.
   */
  async createPending({ email, role = "user", tier = "free" }) {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error("Email tidak valid");
    const existing = this.stmt.findByEmail.get(normalized);
    if (existing) throw new Error("Email sudah terdaftar");
    const now = new Date().toISOString();
    const user = {
      id: randomUUID(),
      email: normalized,
      role: role === "admin" ? "admin" : "user",
      tier,
      status: "pending",
      passwordHash: null,
      createdAt: now,
      updatedAt: now,
    };
    this.stmt.insertUser.run(user.id, user.email, user.role, user.tier, now, now);
    return user;
  }

  /** Set password + aktifkan akun. Idempoten (bisa dipanggil ulang). */
  async setPassword(uid, passwordHash) {
    const now = new Date().toISOString();
    const result = this.stmt.setPassword.run(passwordHash, now, String(uid));
    if (!result.changes) throw new Error("User tidak ditemukan");
    return this.findById(uid);
  }

  async updateUser(uid, { role, tier } = {}) {
    const now = new Date().toISOString();
    const result = this.stmt.updateMeta.run(
      role ? (role === "admin" ? "admin" : "user") : null,
      tier || null,
      now,
      String(uid),
    );
    if (!result.changes) throw new Error("User tidak ditemukan");
    return this.findById(uid);
  }

  async listUsers() {
    return this.stmt.listUsers.all().map(row);
  }

  /**
   * Menghapus user berdasarkan id. Token verifikasi ikut terhapus (FK CASCADE).
   * Digunakan untuk rollback bila pengiriman email verifikasi gagal, agar email
   * dapat didaftarkan ulang. Mengembalikan user yang dihapus (atau null bila tak ada).
   */
  async deleteUser(uid) {
    const existing = await this.findById(uid);
    this.stmt.deleteUser.run(String(uid));
    return existing;
  }

  /** Aktifkan user secara manual (status -> active) tanpa menetapkan password. */
  async activateManually(uid) {
    const now = new Date().toISOString();
    const result = this.stmt.activateUser.run(now, String(uid));
    if (!result.changes) throw new Error("User tidak ditemukan");
    return this.findById(uid);
  }

  /**
   * Membuat token verifikasi acak; menyimpan HASH-nya saja (bukan plain),
   * mengembalikan plain token untuk dikirim via email.
   */
  async issueVerificationToken(uid, expiresAtIso) {
    const plain = randomBytesHex(32);
    const tokenHash = hashToken(plain);
    const now = new Date().toISOString();
    this.stmt.insertToken.run(tokenHash, String(uid), expiresAtIso, now);
    return plain;
  }

  /**
   * Konsumsi token verifikasi: validasi kepemilikan, expiry, dan belum dipakai.
   * Mengembalikan { userId } bila valid, atau null bila tidak.
   * Token ditandai used_at bila valid agar tidak bisa dipakai ulang.
   */
  async consumeVerificationToken(plainToken) {
    const tokenHash = hashToken(String(plainToken || ""));
    const record = this.stmt.findToken.get(tokenHash);
    if (!record) return null;
    if (record.used_at) return null;
    if (new Date(record.expires_at).getTime() <= Date.now()) return null;
    this.stmt.consumeToken.run(new Date().toISOString(), tokenHash);
    return { userId: record.user_id };
  }

  /** Mengembalikan user pemilik token bila token masih valid & belum dipakai. */
  async peekVerificationToken(plainToken) {
    const tokenHash = hashToken(String(plainToken || ""));
    const record = this.stmt.findToken.get(tokenHash);
    if (!record) return null;
    if (record.used_at) return { valid: false, user: null };
    if (new Date(record.expires_at).getTime() <= Date.now()) return { valid: false, user: null };
    const user = await this.findById(record.user_id);
    return { valid: Boolean(user), user };
  }
}

export function hashToken(plain) {
  return createHash("sha256").update(String(plain)).digest("hex");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function row(value) {
  if (!value) return null;
  return {
    id: value.id,
    email: value.email,
    passwordHash: value.password_hash,
    role: value.role,
    tier: value.tier,
    status: value.status,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function randomBytesHex(n) {
  return randomBytes(n).toString("hex");
}
