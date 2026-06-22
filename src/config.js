import { readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvFile(resolve(process.cwd(), ".env"));

export const config = {
  port: toPositiveInt(process.env.PORT, 3000),
  dataDir: resolve(process.env.DATA_DIR || "data"),
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    baseUrl: (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
    maxIterations: toPositiveInt(process.env.AGENT_MAX_ITERATIONS, 16),
    requestLogging: toBoolean(process.env.LLM_REQUEST_LOGGING, false),
    contextOptimize: {
      enabled: toBoolean(process.env.CONTEXT_OPTIMIZE, true),
      mode: process.env.CONTEXT_OPTIMIZE_MODE === "drop" ? "drop" : "summary",
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

function toBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}
