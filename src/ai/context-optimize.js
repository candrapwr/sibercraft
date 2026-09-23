const PAYLOAD_FIELDS = new Set([
  "content",
  "new_string",
  "old_string",
  "tasks",
  "data",
]);

const MAX_SIGNATURE_ARGS = 3;

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
