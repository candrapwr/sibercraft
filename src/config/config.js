import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

loadEnvFile(resolve(process.cwd(), ".env"));

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function generateSessionSecret() {
  return randomBytes(32).toString("hex");
}

const sessionSecret = process.env.SESSION_SECRET?.trim() || generateSessionSecret();
if (!process.env.SESSION_SECRET?.trim()) {
  console.warn("SESSION_SECRET belum diatur di .env; memakai secret acik sementara (session akan reset saat restart).");
}

export const config = {
  port: toPositiveInt(process.env.PORT, 3000),
  dataDir: resolve(process.env.DATA_DIR || "data"),
  workspaceUploadMaxBytes: Math.min(
    toPositiveInt(process.env.WORKSPACE_UPLOAD_MAX_BYTES, 50 * 1024 * 1024),
    250 * 1024 * 1024,
  ),
  appUrl: (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  webScreenshot: {
    endpoint: process.env.WEB_SCREENSHOT_API_URL || "https://snap.idsiber.com/api/screenshot",
  },
  auth: {
    secret: sessionSecret,
    cookieName: "sibercraft_session",
    maxAgeDays: toPositiveInt(process.env.SESSION_MAX_AGE_DAYS, 7),
    adminEmails: new Set(parseList(process.env.ADMIN_EMAILS)),
    passwordMinLength: toPositiveInt(process.env.PASSWORD_MIN_LENGTH, 8),
    verificationTokenHours: toPositiveInt(process.env.VERIFICATION_TOKEN_HOURS, 24),
    anonCookieName: "sibercraft_anon",
    anonMaxAgeDays: toPositiveInt(process.env.ANON_MAX_AGE_DAYS, 30),
    anonProjectLimit: toPositiveInt(process.env.ANON_PROJECT_LIMIT, 3),
  },
  mail: {
    host: process.env.MAIL_HOST || "",
    port: toPositiveInt(process.env.MAIL_PORT, 587),
    username: process.env.MAIL_USERNAME || "",
    password: process.env.MAIL_PASSWORD || "",
    encryption: (process.env.MAIL_ENCRYPTION || "tls").toLowerCase(),
    fromAddress: process.env.MAIL_FROM_ADDRESS || "",
    fromName: process.env.MAIL_FROM_NAME || "SiberCraft",
    mailer: (process.env.MAIL_MAILER || "smtp").toLowerCase(),
  },
  deepseek: {
    apiKey: process.env.PRIMARY_API_KEY || "",
    model: process.env.PRIMARY_MODEL || "deepseek-v4-flash",
    baseUrl: (process.env.PRIMARY_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
    reasoningEffort: resolveReasoningEffort(process.env.REASONING_EFFORT),
    maxOutputTokens: toPositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 200000),
    maxIterations: toPositiveInt(process.env.AGENT_MAX_ITERATIONS, 50),
    requestLogging: toBoolean(process.env.LLM_REQUEST_LOGGING, false),
    contextOptimize: {
      enabled: toBoolean(process.env.CONTEXT_OPTIMIZE, true),
      mode: process.env.CONTEXT_OPTIMIZE_MODE === "drop" ? "drop" : "summary",
      contextWindow: toPositiveInt(process.env.CONTEXT_WINDOW, 200000),
      compactThreshold: toRatio(process.env.CONTEXT_OPTIMIZE_THRESHOLD, 0.8),
      compactKeepRecent: toNonNegativeInt(process.env.CONTEXT_OPTIMIZE_KEEP_RECENT, 2),
      summaryMaxTokens: toPositiveInt(process.env.CONTEXT_SUMMARY_MAX_TOKENS, 1200),
      summaryMaxInputChars: toPositiveInt(process.env.CONTEXT_SUMMARY_MAX_INPUT_CHARS, 120000),
    },
    multimodal: {
      apiKey: process.env.MULTIMODAL_API_KEY || process.env.PRIMARY_API_KEY || "",
      model: process.env.MULTIMODAL_MODEL || "",
      baseUrl: (process.env.MULTIMODAL_BASE_URL || process.env.PRIMARY_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
      reasoningEffort: resolveReasoningEffort(process.env.REASONING_EFFORT),
      maxOutputTokens: toPositiveInt(process.env.AI_MAX_OUTPUT_TOKENS, 200000),
    },
  },
};

function loadEnvFile(path) {
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toRatio(value, fallback) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function toBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function resolveReasoningEffort(value) {
  const normalized = String(value || "none").trim().toLowerCase();
  return ["none", "high", "max"].includes(normalized)
    ? normalized
    : "none";
}
