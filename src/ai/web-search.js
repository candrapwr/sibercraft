import { validatePublicWebUrl } from "../media/web-screenshot.js";

export const IDSIBER_EXA_ENDPOINT = "https://api.idsiber.com/v1/generic/exa";

const SEARCH_RESULT_COUNT = 5;
const DEFAULT_MAX_CHARACTERS = 500;
const MAX_CHARACTERS = 15_000;
const MAX_OUTPUT_CHARACTERS = 200_000;
const MAX_RESPONSE_CHARACTERS = 2_000_000;
const REQUEST_TIMEOUT_MS = 120_000;
const USER_AGENT = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

/**
 * Reuse the primary provider credential for Siber's Exa-compatible gateway.
 * Only the idsiber.com provider is trusted to receive that key.
 */
export function resolveWebSearchConfig({ baseUrl = "", apiKey = "" } = {}) {
  const key = String(apiKey || "").trim();
  let usesIdsiber = false;
  try {
    const hostname = new URL(String(baseUrl)).hostname.toLowerCase();
    usesIdsiber = hostname === "idsiber.com" || hostname.endsWith(".idsiber.com");
  } catch {
    // Invalid/missing provider URLs do not enable the integration.
  }

  return {
    enabled: usesIdsiber && Boolean(key),
    endpoint: IDSIBER_EXA_ENDPOINT,
    apiKey: key,
  };
}

export async function executeWebSearch(args, { endpoint, apiKey, signal } = {}) {
  const mode = String(args?.mode || "").trim().toLowerCase();
  if (!apiKey) throw new Error("Web search belum dikonfigurasi untuk provider idsiber.com");

  if (mode === "search") {
    const query = String(args.query || "").trim();
    if (!query) throw new Error("Parameter query wajib diisi untuk mode search");
    if (query.length > 2_000) throw new Error("Query terlalu panjang (maksimal 2000 karakter)");
    return search(endpoint, apiKey, query, signal);
  }

  if (mode === "content") {
    const requestedUrl = String(args.url || "").trim();
    if (!requestedUrl) throw new Error("Parameter url wajib diisi untuk mode content");
    const url = await validatePublicWebUrl(requestedUrl);
    const requestedMax = Number(args.maxCharacters);
    const maxCharacters = Number.isFinite(requestedMax)
      ? Math.min(MAX_CHARACTERS, Math.max(100, Math.trunc(requestedMax)))
      : DEFAULT_MAX_CHARACTERS;
    return getContent(endpoint, apiKey, url, maxCharacters, signal);
  }

  throw new Error('Parameter mode harus bernilai "search" atau "content"');
}

async function search(endpoint, apiKey, query, signal) {
  const json = await postJson(endpoint, apiKey, "search", {
    query,
    numResults: SEARCH_RESULT_COUNT,
    type: "auto",
    contents: { highlights: true },
  }, signal);
  throwApiError(json, "web search failed");

  const results = Array.isArray(json.results)
    ? json.results.filter((item) => item && typeof item === "object")
    : [];
  if (!results.length) return `No results found for query: ${query}`;

  const lines = [`Found ${results.length} result(s) for: ${query}`, ""];
  for (const [index, result] of results.entries()) {
    const title = clean(result.title) || "(untitled)";
    const url = clean(result.url) || clean(result.id) || "(no url)";
    lines.push(`${index + 1}. ${title}`, `   ${url}`);
    const published = clean(result.publishedDate);
    const author = clean(result.author);
    if (published) lines.push(`   published: ${published}`);
    if (author) lines.push(`   author: ${author}`);
    if (Array.isArray(result.highlights)) {
      const highlights = result.highlights.map(String).join(" … ").replace(/\s+/g, " ").trim();
      if (highlights) lines.push(`   highlights: ${truncate(highlights, 400)}`);
    }
    lines.push("");
  }
  return truncate(lines.join("\n").trim(), MAX_OUTPUT_CHARACTERS);
}

async function getContent(endpoint, apiKey, url, maxCharacters, signal) {
  const json = await postJson(endpoint, apiKey, "contents", {
    ids: [url],
    text: { maxCharacters },
  }, signal);
  throwApiError(json, "web content fetch failed");

  if (Array.isArray(json.statuses)) {
    const status = json.statuses.find((item) => String(item?.id || "") === url);
    if (status && status.status !== "success") {
      const reason = clean(status.reason);
      throw new Error(`could not fetch content for ${url} (status: ${status.status}${reason ? ` — ${reason}` : ""})`);
    }
  }

  const result = Array.isArray(json.results) ? json.results[0] : null;
  if (!result || typeof result !== "object") throw new Error(`no content returned for ${url}`);
  const title = clean(result.title) || "(untitled)";
  const resultUrl = clean(result.url) || url;
  const text = clean(result.text) || "";
  if (!text) return `Title: ${title}\nURL: ${resultUrl}\n\n(no readable text extracted from this page)`;
  return truncate(`Title: ${title}\nURL: ${resultUrl}\n\n${text}`, MAX_OUTPUT_CHARACTERS);
}

async function postJson(endpoint, apiKey, route, body, signal) {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${endpoint.replace(/\/+$/, "")}/${route}`, {
    method: "POST",
    redirect: "error",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Authorization: `Bearer ${apiKey}`,
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: requestSignal,
  });
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_CHARACTERS) throw new Error("Respons web search terlalu besar");

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    const detail = raw.trim().slice(0, 500);
    throw new Error(`respons web search bukan JSON${detail ? `: ${detail}` : ""}`);
  }
  if (!response.ok) {
    const detail = clean(json?.error) || clean(json?.message) || response.statusText || "request failed";
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("respons web search tidak valid");
  }
  return json;
}

function throwApiError(json, label) {
  if (json.error != null || json.message != null) {
    throw new Error(`${label}: ${clean(json.error) || clean(json.message) || "unknown error"}`);
  }
}

function clean(value) {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function truncate(value, limit) {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit)}\n... [truncated ${value.length - limit} chars]`;
}
