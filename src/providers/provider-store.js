// ProviderStore: persists per-user AI provider config (BYOK — bring your own
// key) and aggregate token usage in SQLite. API keys are encrypted at rest
// with AES-256-GCM (see crypto-secret.js); the plaintext is only ever
// materialized in memory, transiently, when the agent runs.
//
// Token usage is incremented ONLY when the user chats using their own private
// provider key (server-default usage is the operator's cost, not the user's,
// and is intentionally not counted here). One row per user, upserted per turn.

// Reserved key for the admin-configured GLOBAL provider (overrides .env for
// every user without an active BYOK config). Reuses the same store/table —
// the key just isn't a real user id, so usage tracking never targets it.
export const GLOBAL_PROVIDER_KEY = "__global__";

import { encryptSecret, decryptSecret, secretFingerprint } from "../auth/crypto-secret.js";

const EMPTY_USAGE = {
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTurns: 0,
  updatedAt: null,
};

export class ProviderStore {
  /**
   * @param {import("node:sqlite").DatabaseSync} db
   * @param {Promise<CryptoKey>|CryptoKey} cryptoKey  AES-GCM key derived from SESSION_SECRET.
   * @param {string} secret  The raw SESSION_SECRET (for fingerprint comparison).
   */
  constructor(db, cryptoKey, secret) {
    this.db = db;
    this.cryptoKey = cryptoKey;
    this.fingerprint = secretFingerprint(secret);
    this.stmt = {
      getConfig: db.prepare("SELECT * FROM user_provider_config WHERE user_id = ?"),
      upsertConfig: db.prepare(`
        INSERT INTO user_provider_config (user_id, enabled, config_blob, key_fingerprint, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          enabled = excluded.enabled,
          config_blob = excluded.config_blob,
          key_fingerprint = excluded.key_fingerprint,
          updated_at = excluded.updated_at
      `),
      deleteConfig: db.prepare("DELETE FROM user_provider_config WHERE user_id = ?"),
      getUsage: db.prepare("SELECT * FROM user_token_usage WHERE user_id = ?"),
      upsertUsage: db.prepare(`
        INSERT INTO user_token_usage (user_id, total_prompt_tokens, total_completion_tokens, total_turns, updated_at)
        VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          total_prompt_tokens = total_prompt_tokens + excluded.total_prompt_tokens,
          total_completion_tokens = total_completion_tokens + excluded.total_completion_tokens,
          total_turns = total_turns + 1,
          updated_at = excluded.updated_at
      `),
      // Global provider lives in its own table (single row, id=1) to avoid the
      // FK constraint on user_provider_config ("__global__" isn't a real user).
      getGlobal: db.prepare("SELECT * FROM global_provider_config WHERE id = 1"),
      upsertGlobal: db.prepare(`
        INSERT INTO global_provider_config (id, enabled, config_blob, key_fingerprint, updated_at)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          config_blob = excluded.config_blob,
          key_fingerprint = excluded.key_fingerprint,
          updated_at = excluded.updated_at
      `),
      deleteGlobal: db.prepare("DELETE FROM global_provider_config WHERE id = 1"),
    };
  }

  /**
   * Read a user's provider config with API keys DECRYPTED (for agent use).
   * Returns a normalized shape:
   *   { enabled, primary:{apiKey,baseUrl,model}, multimodal:{apiKey,baseUrl,model} }
   *
   * Gracefully returns a disabled/empty config if:
   *   - no row exists,
   *   - the stored fingerprint doesn't match the current SESSION_SECRET
   *     (the blob was encrypted under a now-rotated secret and is undecryptable),
   *   - decryption fails for any reason.
   * Never throws — callers rely on this to fall back to the server default.
   */
  async get(userId) {
    const row = this.stmt.getConfig.get(String(userId || ""));
    if (!row || !row.config_blob) return disabledConfig();
    if (row.key_fingerprint !== this.fingerprint) return disabledConfig();
    try {
      const key = await this.cryptoKey;
      const json = await decryptSecret(row.config_blob, key);
      const parsed = JSON.parse(json);
      return {
        enabled: Boolean(row.enabled),
        primary: normalizeProvider(parsed.primary),
        multimodal: normalizeProvider(parsed.multimodal),
      };
    } catch {
      // Blob corrupt or encrypted under a different secret — treat as absent.
      return disabledConfig();
    }
  }

  /**
   * Read config WITHOUT decrypting keys — for sending to the frontend, which
   * must never receive the plaintext API key. Replaces apiKey with a boolean
   * `hasKey`. Same graceful-degradation rules as get().
   */
  async getRedacted(userId) {
    const config = await this.get(userId);
    return {
      enabled: config.enabled,
      primary: redactProvider(config.primary),
      multimodal: redactProvider(config.multimodal),
    };
  }

  /**
   * Read the GLOBAL provider config (decrypted). Same shape and graceful-
   * degradation rules as get(), but reads from global_provider_config (a
   * single-row table without a user FK). Returns a disabled/empty config if
   * no row exists or the secret has rotated.
   */
  async getGlobal() {
    const row = this.stmt.getGlobal.get();
    if (!row || !row.config_blob) return disabledConfig();
    if (row.key_fingerprint !== this.fingerprint) return disabledConfig();
    try {
      const key = await this.cryptoKey;
      const json = await decryptSecret(row.config_blob, key);
      const parsed = JSON.parse(json);
      return {
        enabled: Boolean(row.enabled),
        primary: normalizeProvider(parsed.primary),
        multimodal: normalizeProvider(parsed.multimodal),
      };
    } catch {
      return disabledConfig();
    }
  }

  /** Global config redacted for the admin UI (apiKey → hasKey boolean). */
  async getGlobalRedacted() {
    const config = await this.getGlobal();
    return {
      enabled: config.enabled,
      primary: redactProvider(config.primary),
      multimodal: redactProvider(config.multimodal),
    };
  }

  /**
   * Persist provider config. API keys are encrypted before storage.
   *
   * Keep-existing-key behavior: if `payload.<scope>.apiKey` is blank (empty
   * string or whitespace), the previously stored key for that scope is kept.
   * This lets the user edit baseUrl/model without re-entering the secret.
   * Pass `apiKey: null` to explicitly CLEAR a key.
   */
  async save(userId, payload = {}) {
    const uid = String(userId || "");
    const previous = await this.get(uid);
    const merged = {
      primary: mergeProvider(previous.primary, payload.primary),
      multimodal: mergeProvider(previous.multimodal, payload.multimodal),
    };
    const key = await this.cryptoKey;
    const blob = await encryptSecret(JSON.stringify(merged), key);
    const enabled = payload.enabled ? 1 : 0;
    const now = new Date().toISOString();
    this.stmt.upsertConfig.run(uid, enabled, blob, this.fingerprint, now);
    return this.getRedacted(uid);
  }

  /** Delete the config row entirely (also clears `enabled`). */
  async clear(userId) {
    this.stmt.deleteConfig.run(String(userId || ""));
  }

  /**
   * Persist the GLOBAL provider config. Same keep-existing-key merge logic as
   * save(), but writes to the single-row global_provider_config table.
   */
  async saveGlobal(payload = {}) {
    const previous = await this.getGlobal();
    const merged = {
      primary: mergeProvider(previous.primary, payload.primary),
      multimodal: mergeProvider(previous.multimodal, payload.multimodal),
    };
    const key = await this.cryptoKey;
    const blob = await encryptSecret(JSON.stringify(merged), key);
    const enabled = payload.enabled ? 1 : 0;
    const now = new Date().toISOString();
    this.stmt.upsertGlobal.run(enabled, blob, this.fingerprint, now);
    return this.getGlobalRedacted();
  }

  /** Delete the global provider config row. */
  async clearGlobal() {
    this.stmt.deleteGlobal.run();
  }

  /** Read aggregate usage. Returns the EMPTY_USAGE shape if no row exists. */
  getUsage(userId) {
    const row = this.stmt.getUsage.get(String(userId || ""));
    if (!row) return { ...EMPTY_USAGE };
    return {
      totalPromptTokens: Number(row.total_prompt_tokens) || 0,
      totalCompletionTokens: Number(row.total_completion_tokens) || 0,
      totalTurns: Number(row.total_turns) || 0,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Atomically add a turn's token consumption to the user's running totals.
   * No-ops on non-positive inputs. Upserted via ON CONFLICT.
   */
  incrementUsage(userId, promptTokens = 0, completionTokens = 0) {
    const prompt = Math.max(0, Number(promptTokens) || 0);
    const completion = Math.max(0, Number(completionTokens) || 0);
    if (prompt === 0 && completion === 0) return;
    const now = new Date().toISOString();
    this.stmt.upsertUsage.run(String(userId || ""), prompt, completion, now);
  }
}

function disabledConfig() {
  return {
    enabled: false,
    primary: emptyProvider(),
    multimodal: emptyProvider(),
  };
}

function emptyProvider() {
  return { apiKey: "", baseUrl: "", model: "" };
}

function normalizeProvider(value) {
  const v = value && typeof value === "object" ? value : {};
  return {
    apiKey: typeof v.apiKey === "string" ? v.apiKey : "",
    baseUrl: typeof v.baseUrl === "string" ? v.baseUrl : "",
    model: typeof v.model === "string" ? v.model : "",
  };
}

/** Replace the secret with a presence flag (for frontend consumption). */
function redactProvider(provider) {
  const normalized = normalizeProvider(provider);
  return {
    hasKey: Boolean(normalized.apiKey),
    baseUrl: normalized.baseUrl,
    model: normalized.model,
  };
}

/**
 * Merge an incoming provider payload onto the previously stored one, honoring
 * the keep-existing-key rule: a blank string preserves the old key, while
 * `null` explicitly clears it.
 */
function mergeProvider(previous, incoming) {
  const prev = normalizeProvider(previous);
  if (!incoming || typeof incoming !== "object") return prev;
  const next = { ...prev };
  if (incoming.apiKey === null) next.apiKey = "";
  else if (typeof incoming.apiKey === "string" && incoming.apiKey.trim()) next.apiKey = incoming.apiKey.trim();
  if (typeof incoming.baseUrl === "string") next.baseUrl = incoming.baseUrl.trim();
  if (typeof incoming.model === "string") next.model = incoming.model.trim();
  return next;
}
