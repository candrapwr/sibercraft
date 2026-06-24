import { readFileSync } from "node:fs";
import { resolve } from "node:path";

loadEnvFile(resolve(process.cwd(), ".env"));

export const config = {
  port: toPositiveInt(process.env.PORT, 3000),
  dataDir: resolve(process.env.DATA_DIR || "data"),
  webScreenshot: {
    endpoint: process.env.WEB_SCREENSHOT_API_URL || "https://snap.idsiber.com/api/screenshot",
  },
  deepseek: {
    apiKey: process.env.PRIMARY_API_KEY || "",
    model: process.env.PRIMARY_MODEL || "deepseek-v4-flash",
    baseUrl: (process.env.PRIMARY_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
    maxIterations: toPositiveInt(process.env.AGENT_MAX_ITERATIONS, 50),
    requestLogging: toBoolean(process.env.LLM_REQUEST_LOGGING, false),
    contextOptimize: {
      enabled: toBoolean(process.env.CONTEXT_OPTIMIZE, true),
      mode: process.env.CONTEXT_OPTIMIZE_MODE === "drop" ? "drop" : "summary",
    },
    multimodal: {
      apiKey: process.env.MULTIMODAL_API_KEY || process.env.PRIMARY_API_KEY || "",
      model: process.env.MULTIMODAL_MODEL || "",
      baseUrl: (process.env.MULTIMODAL_BASE_URL || process.env.PRIMARY_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
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
