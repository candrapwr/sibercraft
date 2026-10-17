const PAYLOAD_FIELDS = new Set([
  "content",
  "new_string",
  "old_string",
  "tasks",
  "data",
]);

const MAX_SIGNATURE_ARGS = 3;

/**
 * Remove older complete tool-call/result pairs when the same tool is called
 * again with semantically identical arguments and no intervening workspace
 * mutation. The stored history is never changed; callers receive a sanitized
 * copy for provider payloads and optimized-history snapshots.
 *
 * A pair is removed atomically by call id. In multi-call assistant messages,
 * unrelated calls and their results remain intact. The newest result also gets
 * a compact outcome note so successful or mutating older attempts are not lost.
 */
export function deduplicateToolHistory(messages) {
  const source = Array.isArray(messages) ? messages : [];
  const removedCallIds = new Set();
  const retainedInfo = new Map();
  const seen = new Map();

  for (let index = 0; index < source.length; index++) {
    const message = source[index];
    if (message?.role === "user" || message?.role === "system") {
      seen.clear();
      continue;
    }
    if (message?.role !== "assistant") continue;

    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (!calls.length) {
      // A normal assistant response closes the tool-work sequence. Identical
      // reads in a later user turn remain available as fresh evidence.
      seen.clear();
      continue;
    }

    const resultByCallId = new Map();
    let resultIndex = index + 1;
    while (resultIndex < source.length && source[resultIndex]?.role === "tool") {
      const result = source[resultIndex];
      if (result.tool_call_id && !resultByCallId.has(result.tool_call_id)) {
        resultByCallId.set(result.tool_call_id, { message: result, index: resultIndex });
      }
      resultIndex++;
    }

    // Never alter incomplete or ambiguous provider protocol blocks.
    if (calls.some((call) => !call?.id || !resultByCallId.has(call.id))) {
      seen.clear();
      continue;
    }

    for (const call of calls) {
      const result = resultByCallId.get(call.id).message;
      const fingerprint = toolCallFingerprint(call);
      const previous = seen.get(fingerprint);
      const inherited = previous?.omitted || emptyDedupeOutcomes();

      if (previous) {
        removedCallIds.add(previous.callId);
        const omitted = mergeDedupeOutcomes(inherited, toolResultOutcome(previous.result));
        retainedInfo.set(call.id, omitted);
      }

      const outcome = toolResultOutcome(result);
      // A mutation invalidates earlier read evidence. Keep this call as the new
      // baseline so an immediately repeated mutation can still be collapsed.
      if (outcome.mutated) seen.clear();
      seen.set(fingerprint, {
        callId: call.id,
        result,
        omitted: retainedInfo.get(call.id) || emptyDedupeOutcomes(),
      });
    }
  }

  if (!removedCallIds.size) {
    return {
      messages: source.map(cloneMessage),
      stats: { removedRounds: 0, bytesSaved: 0, valid: hasValidToolProtocol(source) },
    };
  }

  let bytesSaved = 0;
  const sanitized = [];
  for (const message of source) {
    if (message?.role === "assistant" && Array.isArray(message.tool_calls)) {
      const keptCalls = message.tool_calls.filter((call) => !removedCallIds.has(call?.id));
      const removedCalls = message.tool_calls.filter((call) => removedCallIds.has(call?.id));
      bytesSaved += removedCalls.reduce(
        (total, call) => total + JSON.stringify(call).length,
        0,
      );
      if (!keptCalls.length) {
        if (String(message.content || "").trim()) {
          const clean = cloneMessage(message);
          delete clean.tool_calls;
          sanitized.push(clean);
        } else {
          bytesSaved += String(message.content || "").length;
        }
        continue;
      }
      sanitized.push({ ...message, tool_calls: keptCalls.map(cloneToolCall) });
      continue;
    }

    if (message?.role === "tool" && removedCallIds.has(message.tool_call_id)) {
      bytesSaved += JSON.stringify(message).length;
      continue;
    }

    if (message?.role === "tool" && retainedInfo.has(message.tool_call_id)) {
      const info = retainedInfo.get(message.tool_call_id);
      sanitized.push({
        ...message,
        content: `${renderDedupeNote(info)}\n${String(message.content || "")}`,
      });
      continue;
    }

    sanitized.push(cloneMessage(message));
  }

  if (!hasValidToolProtocol(sanitized)) {
    return {
      messages: source.map(cloneMessage),
      stats: { removedRounds: 0, bytesSaved: 0, valid: false },
    };
  }

  return {
    messages: sanitized,
    stats: { removedRounds: removedCallIds.size, bytesSaved, valid: true },
  };
}

function toolCallFingerprint(call) {
  const name = String(call?.function?.name || "tool");
  const rawArgs = String(call?.function?.arguments || "").trim();
  try {
    return `${name}\n${stableJson(JSON.parse(rawArgs || "{}"))}`;
  } catch {
    return `${name}\n${rawArgs}`;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function toolResultOutcome(message) {
  const content = String(message?.content || "");
  const marker = content.match(/^\[TOOL_STATUS=(SUCCESS|FAILED)(; MUTATED)?\]/);
  if (marker) {
    return { status: marker[1], mutated: Boolean(marker[2]) };
  }
  return {
    status: /^Error:/i.test(content.trim()) ? "FAILED" : "SUCCESS",
    mutated: false,
  };
}

function emptyDedupeOutcomes() {
  return { count: 0, success: 0, failed: 0, mutated: 0 };
}

function mergeDedupeOutcomes(summary, outcome) {
  return {
    count: summary.count + 1,
    success: summary.success + (outcome.status === "SUCCESS" ? 1 : 0),
    failed: summary.failed + (outcome.status === "FAILED" ? 1 : 0),
    mutated: summary.mutated + (outcome.mutated ? 1 : 0),
  };
}

function renderDedupeNote(info) {
  return `[TOOL_HISTORY_DEDUPED omitted=${info.count}; previous_success=${info.success}; previous_failed=${info.failed}; previous_mutated=${info.mutated}; latest complete call/result retained]`;
}

function cloneMessage(message) {
  if (!message || typeof message !== "object") return message;
  const clone = { ...message };
  if (Array.isArray(message.tool_calls)) clone.tool_calls = message.tool_calls.map(cloneToolCall);
  return clone;
}

function cloneToolCall(call) {
  return {
    ...call,
    ...(call?.function ? { function: { ...call.function } } : {}),
  };
}

function hasValidToolProtocol(messages) {
  let pending = null;
  for (const message of messages) {
    if (message?.role === "tool") {
      if (!pending || !pending.has(message.tool_call_id)) return false;
      pending.delete(message.tool_call_id);
      continue;
    }
    if (pending?.size) return false;
    pending = null;
    if (message?.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      const ids = message.tool_calls.map((call) => call?.id).filter(Boolean);
      if (ids.length !== message.tool_calls.length || new Set(ids).size !== ids.length) return false;
      pending = new Set(ids);
    }
  }
  return !pending?.size;
}

/**
 * Deterministically fold old tool work so the turns kept verbatim by the
 * summary-mode compaction stay within a character budget.
 *
 * applyContextSummary collapses everything before its boundary, but the turns
 * kept after it can alone exceed the context window when one turn ran dozens
 * of tool iterations (observed: a single turn of ~180k estimated tokens).
 * This folds those kept turns — oldest first — into the same per-turn
 * [SUMMARY] digest format the system prompt already documents. The stored
 * history is never modified; only the provider payload view changes.
 *
 * Budget semantics: `budgetChars` is compared against the total rendered
 * chars (content + tool-call arguments). When over budget:
 *   1. every complete turn except the most recent one is folded to a digest;
 *   2. if still over budget, the most recent turn's leading tool rounds are
 *      folded too, keeping the last `keepRecentRounds` rounds verbatim and
 *      clipping oversized tool results in what remains.
 */
export function foldKeptTurnsForBudget(messages, { budgetChars = Infinity, keepRecentRounds = 2, maxToolResultChars = 24_000 } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const stats = { foldedTurns: 0, clippedResults: 0, charsSaved: 0 };
  const limit = Number(budgetChars);
  if (!Number.isFinite(limit) || totalMessageChars(source) <= limit) {
    return { messages: source, stats };
  }

  const turnStarts = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index]?.role === "user") turnStarts.push(index);
  }
  if (!turnStarts.length) return { messages: source, stats };

  // Segment bounds: a leading partial segment (before the first user message)
  // plus one segment per user turn.
  const bounds = [];
  if (turnStarts[0] > 0) bounds.push({ start: 0, end: turnStarts[0], complete: false });
  for (let index = 0; index < turnStarts.length; index++) {
    bounds.push({
      start: turnStarts[index],
      end: index + 1 < turnStarts.length ? turnStarts[index + 1] : source.length,
      complete: true,
    });
  }
  const completeTurnIndexes = bounds
    .map((bound, index) => (bound.complete ? index : -1))
    .filter((index) => index >= 0);

  const foldedBySegment = new Map();
  let chars = totalMessageChars(source);

  // 1) Fold older complete turns, oldest first, until back under budget.
  for (const segmentIndex of completeTurnIndexes.slice(0, -1)) {
    if (chars <= limit) break;
    const bound = bounds[segmentIndex];
    const folded = foldTurnSegment(source.slice(bound.start, bound.end));
    if (!folded) continue;
    chars -= folded.charsSaved;
    foldedBySegment.set(segmentIndex, folded.messages);
    stats.foldedTurns++;
  }

  // 2) Still over budget: partially fold the most recent turn itself.
  if (chars > limit && completeTurnIndexes.length) {
    const segmentIndex = completeTurnIndexes[completeTurnIndexes.length - 1];
    const bound = bounds[segmentIndex];
    const partial = foldTurnLeadingRounds(source.slice(bound.start, bound.end), { keepRecentRounds, maxToolResultChars });
    if (partial) {
      foldedBySegment.set(segmentIndex, partial.messages);
      stats.clippedResults += partial.clippedResults;
      stats.foldedTurns++;
    }
  }

  if (!foldedBySegment.size) return { messages: source, stats };

  const output = [];
  for (let index = 0; index < bounds.length; index++) {
    const bound = bounds[index];
    if (foldedBySegment.has(index)) {
      output.push(...foldedBySegment.get(index));
    } else {
      output.push(...source.slice(bound.start, bound.end));
    }
  }
  stats.charsSaved = Math.max(0, totalMessageChars(source) - totalMessageChars(output));
  return { messages: output, stats };
}

/** Fold one complete turn (user message + tool work + final text) into a digest. */
function foldTurnSegment(segment) {
  const head = segment[0];
  if (head?.role !== "user" || typeof head.content !== "string") return null;
  const actions = [];
  const kept = [];
  for (const message of segment.slice(1)) {
    if (message?.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      for (const call of message.tool_calls) {
        actions.push({
          id: call.id,
          signature: renderSignature(call.function?.name || "tool", call.function?.arguments || ""),
          status: "NOT_EXECUTED",
          result: "",
        });
      }
      continue;
    }
    if (message?.role === "tool") {
      const parsed = parseToolStatus(message.content);
      const action = actions.find((candidate) => candidate.id === message.tool_call_id && candidate.status === "NOT_EXECUTED");
      if (action) {
        action.status = parsed.status;
        action.result = parsed.result;
      } else {
        actions.push({ id: message.tool_call_id, signature: message.name || "tool", status: parsed.status, result: parsed.result });
      }
      continue;
    }
    if (message?.role === "assistant") {
      if (String(message.content || "").trim()) kept.push({ ...message, content: message.content });
      continue;
    }
    kept.push(message);
  }
  if (!actions.length) return null;
  const digest = actions.map(renderActionSummary).join("\n");
  const charsSaved = totalMessageChars(segment) - totalMessageChars([{ ...head, content: `${head.content} ${digest}` }, ...kept]);
  if (charsSaved <= 0) return null;
  return {
    messages: [{ ...head, content: `${head.content}\n\n[SUMMARY]\n${digest}` }, ...kept],
    charsSaved,
  };
}

/** Fold only the leading tool rounds of a turn, keeping the recent rounds verbatim. */
function foldTurnLeadingRounds(segment, { keepRecentRounds, maxToolResultChars }) {
  const roundIndexes = [];
  for (let index = 0; index < segment.length; index++) {
    const message = segment[index];
    if (message?.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length) roundIndexes.push(index);
  }
  const keep = Math.max(1, Math.floor(Number(keepRecentRounds) || 0));
  if (roundIndexes.length <= keep) return null;
  const retainedStart = roundIndexes[roundIndexes.length - keep];
  const foldedPrefix = foldTurnSegment(segment.slice(0, retainedStart));
  if (!foldedPrefix) return null;

  let clippedResults = 0;
  const suffix = segment.slice(retainedStart).map((message) => {
    if (message?.role === "tool" && typeof message.content === "string" && message.content.length > maxToolResultChars) {
      clippedResults++;
      return {
        ...message,
        content: `${message.content.slice(0, maxToolResultChars)}\n…[hasil dipotong ${message.content.length - maxToolResultChars} karakter; bila bagian akhir diperlukan, panggil ulang dengan offset/limit]`,
      };
    }
    return message;
  });
  return { messages: [...foldedPrefix.messages, ...suffix], clippedResults };
}

function totalMessageChars(messages) {
  let total = 0;
  for (const message of messages) {
    total += typeof message?.content === "string" ? message.content.length : 0;
    total += (message?.tool_calls || []).reduce(
      (sum, call) => sum + (call?.function?.arguments?.length || 0),
      0,
    );
  }
  return total;
}

export function renderSignature(name, rawArgs) {
  let args = {};
  try {
    const parsed = rawArgs?.trim() ? JSON.parse(rawArgs) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
  } catch {
    return name;
  }

  const entries = Object.entries(args).filter(([key]) => !PAYLOAD_FIELDS.has(key));
  if (!entries.length) return name;

  const rendered = [];
  for (const [key, value] of entries) {
    if (rendered.length >= MAX_SIGNATURE_ARGS) {
      rendered.push("…");
      break;
    }
    if (key === "offset" && entries.some(([candidate]) => candidate === "limit")) continue;
    if (key === "limit") {
      const offset = args.offset;
      if (typeof offset === "number" && typeof value === "number") {
        rendered.push(`${offset}-${value}`);
      } else {
        rendered.push(`limit=${shortValue(value)}`);
      }
      continue;
    }
    rendered.push(shortValue(value));
  }

  return `${name}(${rendered.join(", ")})`;
}

function shortValue(value) {
  if (typeof value === "string") {
    const compact = value.length > 60 ? `${value.slice(0, 57)}…` : value;
    return JSON.stringify(compact);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return "…";
}

export function optimizeContext(messages, config = { enabled: true, mode: "summary" }) {
  const stats = { collapsedCount: 0, bytesSaved: 0 };
  if (!config?.enabled) return { messages: [...messages], stats };

  const mode = config.mode || "summary";
  const result = [];
  const turnActions = [];
  let pendingUserIndex = -1;

  const finalizePendingUser = () => {
    if (mode !== "summary" || pendingUserIndex === -1 || !turnActions.length) return;
    const target = result[pendingUserIndex];
    target.content = `${target.content}\n\n[SUMMARY]\n${turnActions.map(renderActionSummary).join("\n")}`;
    turnActions.length = 0;
  };

  for (const message of messages) {
    if (message.role === "system") {
      finalizePendingUser();
      result.push({ role: "system", content: message.content });
      pendingUserIndex = -1;
      turnActions.length = 0;
      continue;
    }

    if (message.role === "user") {
      finalizePendingUser();
      result.push({ role: "user", content: message.content });
      pendingUserIndex = result.length - 1;
      turnActions.length = 0;
      continue;
    }

    if (message.role === "assistant") {
      const calls = message.tool_calls || [];
      if (calls.length > 0) {
        stats.collapsedCount += calls.length;
        stats.bytesSaved += message.content?.length || 0;
        for (const call of calls) {
          const name = call.function?.name || "tool";
          const args = call.function?.arguments || "";
          stats.bytesSaved += args.length;
          if (mode === "summary") {
            turnActions.push({
              id: call.id,
              signature: renderSignature(name, args),
              status: "NOT_EXECUTED",
              result: "",
            });
          }
        }
        continue;
      }
      const content = message.content || " ";
      // An assistant sentence is not evidence that a workspace operation ran.
      // Keep the text, but make that distinction explicit for the next model.
      result.push({
        role: "assistant",
        content: turnActions.length ? content : `[ASSISTANT_NO_TOOL_EVIDENCE] ${content}`,
      });
      continue;
    }

    if (message.role === "tool") {
      stats.bytesSaved += message.content?.length || 0;
      if (mode === "summary") {
        const action = turnActions.find((candidate) => candidate.id === message.tool_call_id);
        const parsed = parseToolStatus(message.content);
        if (action) {
          action.status = parsed.status;
          action.result = parsed.result;
        } else {
          // Preserve evidence even when importing an old/incomplete history
          // whose tool_call_id does not match its assistant call.
          turnActions.push({
            id: message.tool_call_id,
            signature: message.name || "tool",
            status: parsed.status,
            result: parsed.result,
          });
        }
      }
    }
  }

  finalizePendingUser();

  const merged = [];
  for (const message of result) {
    const last = merged.at(-1);
    if (last?.role === "user" && message.role === "user") {
      last.content = `${last.content}\n${message.content}`;
      continue;
    }
    if (last?.role === "assistant" && message.role === "assistant") {
      const previous = last.content || "";
      const next = message.content || "";
      last.content = previous && next ? `${previous}\n${next}` : previous || next || " ";
      continue;
    }
    merged.push({ ...message });
  }

  return { messages: merged, stats };
}

function parseToolStatus(content = "") {
  const text = String(content || "");
  const marker = text.match(/^\[TOOL_STATUS=(SUCCESS|FAILED)(?:; MUTATED)?\]\s*[^:]+:\s*/);
  if (marker) {
    return {
      status: marker[1],
      result: text.slice(marker[0].length).slice(0, 180).replace(/\s+/g, " "),
    };
  }
  const failed = /^Error:/i.test(text.trim());
  return {
    status: failed ? "FAILED" : "SUCCESS",
    result: failed ? text.slice(0, 180).replace(/\s+/g, " ") : "",
  };
}

function renderActionSummary(action) {
  const suffix = action.status === "FAILED" && action.result ? ` — ${action.result}` : "";
  return `${action.signature} → ${action.status}${suffix}`;
}
