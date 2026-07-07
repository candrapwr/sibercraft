/**
 * Categorize an AI error for the admin log. Order matters: structured fields
 * set by DeepSeekClient (error.status / error.errorType) win first, then we
 * inspect error.name and message substrings as a fallback.
 *
 * Kept in its own module (no side effects) so it can be unit-tested without
 * importing server.js (which starts the HTTP server on load).
 *
 * @param {Error|null|undefined} error
 * @returns {"HTTP"|"Server"|"Network"|"AbortError"|"Config"|"MaxIterations"|"Unknown"}
 */
export function classifyError(error) {
  if (error?.errorType) return error.errorType; // "Server" | "HTTP" (set by deepseek.js)
  if (error?.status >= 500) return "Server";
  if (error?.status) return "HTTP";
  const name = error?.name || "";
  const msg = String(error?.message || "");
  if (name === "AbortError") return "AbortError";
  if (name === "TypeError") return "Network"; // fetch() failures (DNS, offline, timeout)
  if (/belum dikonfigurasi/i.test(msg)) return "Config";
  if (/mencapai batas .* iterasi/i.test(msg)) return "MaxIterations";
  return "Unknown";
}
