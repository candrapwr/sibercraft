import test from "node:test";
import assert from "node:assert/strict";

// classifyError lives in its own module (no side effects) so it can be tested
// without booting the HTTP server.
import { classifyError } from "../src/observability/classify-error.js";

test("classifyError: HTTP 4xx (deepseek errorType field) → 'HTTP'", () => {
  const error = new Error("Primary AI API 401: invalid");
  error.status = 401;
  error.errorType = "HTTP";
  assert.equal(classifyError(error), "HTTP");
});

test("classifyError: HTTP 5xx (deepseek errorType field) → 'Server'", () => {
  const error = new Error("Primary AI API 500: internal");
  error.status = 500;
  error.errorType = "Server";
  assert.equal(classifyError(error), "Server");
});

test("classifyError: errorType field menang atas status", () => {
  // deepseek.js sets errorType explicitly; it should win even if status ambiguous.
  const error = new Error("API 503");
  error.status = 503;
  error.errorType = "HTTP";
  assert.equal(classifyError(error), "HTTP");
});

test("classifyError: status >= 500 tanpa errorType → 'Server'", () => {
  const error = new Error("fail");
  error.status = 502;
  assert.equal(classifyError(error), "Server");
});

test("classifyError: status 4xx tanpa errorType → 'HTTP'", () => {
  const error = new Error("fail");
  error.status = 429;
  assert.equal(classifyError(error), "HTTP");
});

test("classifyError: AbortError (name) → 'AbortError'", () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  assert.equal(classifyError(error), "AbortError");
});

test("classifyError: TypeError (fetch failure) → 'Network'", () => {
  const error = new TypeError("fetch failed");
  assert.equal(classifyError(error), "Network");
});

test("classifyError: 'belum dikonfigurasi' di message → 'Config'", () => {
  const error = new Error("Model multimodal belum dikonfigurasi");
  assert.equal(classifyError(error), "Config");
});

test("classifyError: 'mencapai batas ... iterasi' → 'MaxIterations'", () => {
  const error = new Error("Agent mencapai batas 50 iterasi");
  assert.equal(classifyError(error), "MaxIterations");
});

test("classifyError: error tanpa konteks → 'Unknown'", () => {
  assert.equal(classifyError(new Error("something else")), "Unknown");
  assert.equal(classifyError(null), "Unknown");
  assert.equal(classifyError(undefined), "Unknown");
});

test("classifyError: timeout (DOMException tanpa name khusus) → 'Unknown' atau 'Network'", () => {
  // Native timeout dari fetch biasanya TypeError atau DOMException.
  // Pastikan tidak crash dan return string valid.
  const result = classifyError(new Error("The operation was aborted due to timeout"));
  assert.ok(typeof result === "string" && result.length > 0);
});
