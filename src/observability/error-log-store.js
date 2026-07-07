// ErrorLogStore: persists AI errors (primary & multimodal) for admin
// observability. One row per failed AI turn — AbortError (user stop) is never
// logged because it isn't a real failure. Prompts are intentionally NOT stored
// (privacy); admins can open the session via its id for deeper investigation.
//
// Retention is manual: admins delete individual entries or clear all from the
// admin panel. There is no auto-trim; the table grows until an admin cleans it.

import { randomUUID } from "node:crypto";

export class ErrorLogStore {
  constructor(db) {
    this.db = db;
    this.stmt = {
      insert: db.prepare(`
        INSERT INTO ai_error_logs (id, session_id, owner_id, model, provider_source, mode, error_message, error_type, iteration, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      countAll: db.prepare("SELECT COUNT(*) AS n FROM ai_error_logs"),
      deleteOne: db.prepare("DELETE FROM ai_error_logs WHERE id = ?"),
      clearAll: db.prepare("DELETE FROM ai_error_logs"),
    };
  }

  /**
   * Record a single AI error. Best-effort caller should swallow DB errors so a
   * logging failure never breaks the chat flow. Returns the new log id.
   */
  log({ sessionId, ownerId, model, providerSource, mode, errorMessage, errorType, iteration }) {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.stmt.insert.run(
      id,
      sessionId || null,
      ownerId || null,
      model || null,
      providerSource || null,
      mode || null,
      String(errorMessage || "Unknown error").slice(0, 2000),
      errorType || "Unknown",
      Number.isFinite(iteration) ? iteration : null,
      now,
    );
    return id;
  }

  /**
   * List error logs with optional filters, newest first.
   * @param {object} options
   * @param {number} options.limit   Page size (default 50).
   * @param {number} options.offset  Skip N entries (default 0).
   * @param {string} options.model   Filter by model name (substring match).
   * @param {string} options.ownerId Filter by owner id (exact match).
   * @param {string} options.errorType Filter by error type (exact match).
   * @param {string} options.since   ISO date; only entries at/after this time.
   * @returns {Array} rows
   */
  list({ limit = 50, offset = 0, model, ownerId, errorType, since } = {}) {
    const where = [];
    const params = [];
    if (model) { where.push("model LIKE ?"); params.push(`%${model}%`); }
    if (ownerId) { where.push("owner_id = ?"); params.push(ownerId); }
    if (errorType) { where.push("error_type = ?"); params.push(errorType); }
    if (since) { where.push("created_at >= ?"); params.push(since); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const sql = `SELECT * FROM ai_error_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    return this.db.prepare(sql).all(...params, safeLimit, safeOffset).map(rowToLog);
  }

  /**
   * Count total entries matching the same filters (for pagination). Same filter
   * semantics as list(), but ignores limit/offset.
   */
  count({ model, ownerId, errorType, since } = {}) {
    const where = [];
    const params = [];
    if (model) { where.push("model LIKE ?"); params.push(`%${model}%`); }
    if (ownerId) { where.push("owner_id = ?"); params.push(ownerId); }
    if (errorType) { where.push("error_type = ?"); params.push(errorType); }
    if (since) { where.push("created_at >= ?"); params.push(since); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ai_error_logs ${clause}`).get(...params).n) || 0;
  }

  /** Delete one entry by id. Returns true if a row was removed. */
  delete(id) {
    const result = this.stmt.deleteOne.run(String(id || ""));
    return result.changes > 0;
  }

  /** Delete every entry. Returns the number of rows removed. */
  clearAll() {
    const result = this.stmt.clearAll.run();
    return result.changes || 0;
  }
}

function rowToLog(value) {
  return {
    id: value.id,
    sessionId: value.session_id,
    ownerId: value.owner_id,
    model: value.model,
    providerSource: value.provider_source,
    mode: value.mode,
    errorMessage: value.error_message,
    errorType: value.error_type,
    iteration: value.iteration,
    createdAt: value.created_at,
  };
}
