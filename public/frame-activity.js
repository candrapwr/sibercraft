// Frame activity HUD — makes AI progress visible on preview frames.
//
// The old overlay was a lone spinner: during long model calls (or when a
// provider buffers a tool call into a single SSE chunk, so nothing streams)
// the preview looks frozen even though the agent is alive. This module tracks
// the whole NDJSON turn — every event, every ping, tool phases, draft sizes,
// iterations, elapsed time — and renders a live status card onto whichever
// frames are currently in "drafting" state.
//
// Liveness never depends on argument streaming: the 1s ticker, the event
// counter, and the server's 15s heartbeat pings keep the card visibly moving
// even when the provider sends one big chunk or stays silent for minutes.

import { canvas } from "/canvas.js";
import { translate } from "/i18n.js";
import { formatBytes } from "/app-utils.js";

const TICK_MS = 1_000;
const WAITING_AFTER_MS = 8_000;    // no meaningful signal this long → "waiting for model"
const CONN_FRESH_MS = 45_000;      // last ping newer than this → connection healthy
const CONN_SLOW_MS = 90_000;       // last ping newer than this → connection slow
const LONG_RUN_MS = 90_000;        // hint for very long turns
const ERROR_FLASH_MS = 9_000;      // how long the failure card stays visible
const DONE_FLASH_MS = 2_500;       // brief success flash before clearing

const TOOL_PHASE = {
  create_frame: "framePhasePreparing",
  write_file: "framePhaseWriting",
  edit_file: "framePhaseEditing",
  read_file: "framePhaseReading",
  grep: "framePhaseSearching",
  list_dir: "framePhaseListing",
  web_search: "framePhaseSearchingWeb",
  capture_webpage_screenshot: "framePhaseCapturing",
};

const state = {
  running: false,
  startedAt: 0,
  eventCount: 0,
  iteration: 0,
  wrapUpRemaining: 0,
  phase: null,          // { key, file }
  draft: null,          // { path, size } from preview_draft
  lastSignalAt: 0,      // last non-ping event (real progress)
  lastPingAt: 0,        // last server heartbeat
  finished: null,       // null | { ok, message }
};

let ticker = null;
let clearTimer = null;
let lastSignature = "";

function now() {
  return Date.now();
}

function lang() {
  return document.documentElement.lang;
}

function t(key, vars = {}) {
  return translate(lang(), key, vars);
}

function compactNumber(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}jt`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(".", ",")}rb`;
  return String(value);
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function toolTargetFile(name, rawArguments) {
  try {
    const args = JSON.parse(rawArguments || "{}");
    if (args && typeof args.path === "string" && args.path) return args.path;
    if (args && typeof args.file === "string" && args.file) return args.file;
  } catch {
    // partial JSON while streaming — ignore, next chunk completes it
  }
  return null;
}

export const frameActivity = {
  /** Reset state at the start of every chat turn. */
  turnStart() {
    state.running = true;
    state.startedAt = now();
    state.eventCount = 0;
    state.iteration = 0;
    state.wrapUpRemaining = 0;
    state.phase = null;
    state.draft = null;
    state.lastSignalAt = now();
    state.lastPingAt = 0;
    state.finished = null;
    lastSignature = "";
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
    if (!ticker) ticker = setInterval(render, TICK_MS);
    render();
  },

  /** Feed every NDJSON event here; the card stays in sync with the turn. */
  track(event) {
    if (!state.running || !event || !event.type) return;
    state.eventCount++;
    switch (event.type) {
      case "ping":
        state.lastPingAt = now();
        return; // heartbeat only — not counted as a progress signal
      case "status":
      case "assistant_start":
      case "content":
        state.lastSignalAt = now();
        if (!state.phase && event.type === "status") {
          state.phase = { key: event.status === "thinking" ? "framePhaseThinking" : "framePhaseWorking" };
        }
        break;
      case "iteration_model":
        state.lastSignalAt = now();
        state.iteration = Number(event.iteration) || state.iteration;
        break;
      case "tool_start":
      case "tool_args": {
        state.lastSignalAt = now();
        const name = event.name || "";
        const phaseKey = TOOL_PHASE[name];
        if (phaseKey) {
          const file = toolTargetFile(name, event.arguments);
          state.phase = { key: phaseKey, file: file || state.draft?.path || null };
        }
        break;
      }
      case "preview_draft":
        state.lastSignalAt = now();
        state.draft = { path: event.path, size: Number(event.size) || 0 };
        state.phase = { key: "framePhaseWriting", file: event.path };
        break;
      case "frame_working":
        state.lastSignalAt = now();
        state.phase = { key: "framePhasePreparing" };
        break;
      case "tool_result":
      case "iteration_end":
        state.lastSignalAt = now();
        break;
      case "wrap_up":
        state.wrapUpRemaining = Number(event.remainingIterations) || 0;
        break;
      case "error":
        // A user stop arrives as an error event with "dihentikan" in the
        // message — show it as a neutral stop, not a red failure.
        finish(!/dihentikan/i.test(String(event.message || "")), event.message || "");
        break;
      case "done":
        finish(true);
        break;
      default:
        break;
    }
  },

  /** End the turn from outside the stream (fetch failure, stop button). */
  finish(ok, message = "") {
    finish(ok, message);
  },
};

function finish(ok, message = "") {
  if (!state.running) return;
  state.running = false;
  state.finished = { ok, message, stopped: !ok && /dihentikan/i.test(message) };
  state.finishedAt = now();
  // Capture the flashing frames now: once the turn cleanup clears .drafting,
  // getDraftingFrameEls() would no longer find them to remove the flash class.
  const flashTargets = canvas.getDraftingFrameEls();
  render(flashTargets);
  if (ticker) { clearInterval(ticker); ticker = null; }
  if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
  clearTimer = setTimeout(() => {
    clearTimer = null;
    for (const { el } of flashTargets) el.classList.remove("frame-error", "frame-done");
    lastSignature = "";
  }, ok ? DONE_FLASH_MS : ERROR_FLASH_MS);
}

function phaseLabel(waiting) {
  if (waiting) return t("frameWaitingModel");
  if (state.phase) {
    return t(state.phase.key, { file: state.phase.file || "" });
  }
  return t("framePhaseThinking");
}

function detailLine(elapsed, waiting) {
  if (state.draft && !waiting) {
    const size = formatBytes(state.draft.size || 0);
    return `${state.draft.path} · ${size} · ${t("frameLiveIndicator")}`;
  }
  if (state.phase?.file && !waiting) return state.phase.file;
  if (state.wrapUpRemaining > 0) return t("frameWrapUpHint", { count: state.wrapUpRemaining });
  if (elapsed >= LONG_RUN_MS) return t("frameLongRunHint");
  return "";
}

function connectionLabel() {
  if (!state.lastPingAt) return t("frameConnectionUnknown");
  const sincePing = now() - state.lastPingAt;
  if (sincePing <= CONN_FRESH_MS) return t("frameConnectionAlive");
  if (sincePing <= CONN_SLOW_MS) return t("frameConnectionSlow");
  return t("frameConnectionSlow");
}

function render(explicitTargets = null) {
  const targets = explicitTargets || canvas.getDraftingFrameEls();
  if (!targets.length) { lastSignature = ""; return; }

  const finished = state.finished;
  const waiting = !finished && state.running && (now() - state.lastSignalAt) > WAITING_AFTER_MS;
  const elapsed = finished ? (state.finishedAt - state.startedAt) : now() - state.startedAt;

  const phase = finished
    ? (finished.ok
        ? t("frameTurnDone")
        : finished.stopped ? t("frameStopped") : t("frameTurnFailed", { message: finished.message }))
    : phaseLabel(waiting);
  const detail = finished ? (finished.ok ? "" : finished.message) : detailLine(elapsed, waiting);
  const timer = formatElapsed(elapsed);
  const conn = finished ? "" : connectionLabel();
  const events = compactNumber(state.eventCount);
  const iter = state.iteration > 0 ? t("frameIterLabel", { count: state.iteration }) : "";

  const signature = [phase, detail, timer, conn, events, iter, waiting, Boolean(finished), finished?.ok, finished?.stopped].join("\u0001");
  if (signature === lastSignature) return;
  lastSignature = signature;

  for (const { el } of targets) {
    const card = el.querySelector(".frame-activity");
    if (!card) continue;
    card.querySelector(".fa-phase") && (card.querySelector(".fa-phase").textContent = phase);
    card.querySelector(".fa-timer") && (card.querySelector(".fa-timer").textContent = timer);
    const detailEl = card.querySelector(".fa-detail");
    if (detailEl) {
      detailEl.textContent = detail || "\u00a0";
      detailEl.classList.toggle("has-text", Boolean(detail));
    }
    const connEl = card.querySelector(".fa-conn");
    if (connEl) connEl.textContent = conn;
    const eventsEl = card.querySelector(".fa-events");
    if (eventsEl) eventsEl.textContent = t("frameEventsLabel", { count: events });
    const iterEl = card.querySelector(".fa-iter");
    if (iterEl) {
      iterEl.textContent = iter;
      iterEl.classList.toggle("has-text", Boolean(iter));
    }
    card.classList.toggle("is-waiting", waiting);
    card.classList.toggle("is-long", !finished && elapsed >= LONG_RUN_MS);
    card.classList.toggle("is-done", Boolean(finished?.ok));
    card.classList.toggle("is-error", Boolean(finished && !finished.ok && !finished.stopped));
    card.classList.toggle("is-stopped", Boolean(finished?.stopped));
    el.classList.toggle("frame-done", Boolean(finished?.ok));
    el.classList.toggle("frame-error", Boolean(finished && !finished.ok && !finished.stopped));
  }
}
