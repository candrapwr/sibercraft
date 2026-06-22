import { createFileTools } from "./file-tools.js";
import { optimizeContext } from "./context-optimize.js";
import { DeepSeekClient } from "./deepseek.js";

const SYSTEM_PROMPT = `You are the AI frontend engineer inside the SiberCraft app.
Your job is to create and modify web mockups that run directly in the browser.

Working rules:
- All deliverables must be static web files inside the workspace: HTML, CSS, JavaScript, SVG, JSON, or related text assets.
- index.html is the preview entry point. Keep it valid and always previewable.
- Use read_file before changing an existing file, and use list_dir when the workspace structure is still unclear.
- Use the file tools to implement the requested work for real, not just to describe code in chat.
- When you decide to call tools, always include a short natural-language progress note before or alongside the tool call so the assistant message content is never empty.
- Produce responsive, high-quality results. Prefer semantic HTML, structured CSS, and browser-native JavaScript without a build step.
- Browser libraries over HTTPS CDN are allowed when useful for charts or diagrams, but prefer lightweight solutions first.
- Never access secret APIs, the host filesystem, Node.js APIs, or the parent window from preview code.
- If older user messages include a [SUMMARY] block, treat it only as a record of which tools ran in that past turn. Do not assume the old file contents or tool results are still current; re-run tools when actual details are needed.
- Finish all requested changes before giving the final answer.
- The final answer must stay short and in Bahasa Indonesia: explain what was built and mention the main files changed. Do not paste full source code into chat.`;

const CONVERSATION_PROMPT = `${SYSTEM_PROMPT}

This user message is normal conversation, not an instruction to change the mockup. Reply directly in a friendly, concise way in 1-3 sentences. Do not mention or imply that you inspected workspace files.`;

export function isConversationalPrompt(prompt) {
  const normalized = prompt.trim().toLowerCase().replace(/[!.,?]+$/g, "").trim();
  return /^(halo|hai|hi|hello|hey|pagi|siang|sore|malam|selamat pagi|selamat siang|selamat sore|selamat malam|terima kasih|makasih|thanks|thank you|apa kabar)$/.test(normalized);
}

export async function runAgent({ session, store, prompt, config, signal, emit }) {
  const workspaceDir = store.workspaceDir(session.id);
  const conversational = isConversationalPrompt(prompt);
  let mutated = false;
  const tools = createFileTools(workspaceDir, async (path) => {
    mutated = true;
    await store.update(session.id, { status: "working" });
    emit({ type: "preview", path });
  });
  const client = new DeepSeekClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: session.model || config.model,
  });
  const history = await store.history(session.id);
  const sessionUsage = session.usage || emptyUsage();
  history.push({ role: "user", content: prompt });
  await store.saveHistory(session.id, history);
  await store.update(session.id, { status: "working", lastPrompt: prompt.slice(0, 140) });
  const snapshotEndIndex = history.length;
  const optimizedBase = conversational
    ? { messages: [...history], stats: { collapsedCount: 0, bytesSaved: 0 } }
    : optimizeContext(history, config.contextOptimize);
  if (!conversational && optimizedBase.stats.collapsedCount > 0) {
    emit({ type: "context_optimized", bytesSaved: optimizedBase.stats.bytesSaved });
  }
  await store.saveOptimizedHistory(session.id, optimizedBase.messages, {
    collapsedCount: optimizedBase.stats.collapsedCount,
    bytesSaved: optimizedBase.stats.bytesSaved,
    mode: config.contextOptimize.mode,
  });

  const requestBase = () => {
    const base = conversational ? [...history] : [...optimizedBase.messages, ...history.slice(snapshotEndIndex)];
    return [{ role: "system", content: conversational ? CONVERSATION_PROMPT : SYSTEM_PROMPT }, ...base];
  };
  let finalText = "";
  let usage = null;
  let turnPromptTokens = 0;
  let turnCompletionTokens = 0;

  try {
    for (let iteration = 0; iteration < config.maxIterations; iteration++) {
      emit({ type: "status", status: iteration === 0 ? "thinking" : "working" });
      emit({ type: "assistant_start" });
      const messages = requestBase();
      if (config.requestLogging) {
        await store.appendLlmRequestLog(session.id, {
          timestamp: new Date().toISOString(),
          sessionId: session.id,
          iteration: iteration + 1,
          conversational,
          optimization: conversational
            ? { enabled: false, mode: "conversation-bypass" }
            : {
                enabled: Boolean(config.contextOptimize?.enabled),
                mode: config.contextOptimize?.mode || "summary",
                collapsedCount: optimizedBase.stats.collapsedCount,
                bytesSaved: optimizedBase.stats.bytesSaved,
              },
          request: {
            model: session.model || config.model,
            stream: true,
            stream_options: { include_usage: true },
            toolCount: conversational ? 0 : tools.schemas.length,
            messages,
            ...(conversational ? {} : { tools: tools.schemas }),
          },
        });
      }
      const announcedToolCalls = new Set();
      const draftProgress = new Map();
      let receivedModelContent = false;
      let syntheticNarration = "";
      const emitWriteDraft = (call, force = false) => {
        if (call.name !== "write_file") return;
        const current = draftProgress.get(call.index) || { lastCheck: 0, lastRawLength: 0, lastContentLength: 0 };
        const now = Date.now();
        const rawLength = call.arguments?.length || 0;
        if (!force && now - current.lastCheck < 100 && rawLength - current.lastRawLength < 8192) return;
        current.lastCheck = now;
        current.lastRawLength = rawLength;
        const draft = extractWriteFileDraft(call.arguments || "");
        if (draft && (force || draft.content.length - current.lastContentLength >= 128)) {
          current.lastContentLength = draft.content.length;
          emit({ type: "preview_draft", callIndex: call.index, path: draft.path, content: draft.content });
        }
        draftProgress.set(call.index, current);
      };
      const completion = await client.complete({
        messages,
        tools: conversational ? [] : tools.schemas,
        signal,
        onContent: (delta) => {
          if (syntheticNarration && !receivedModelContent) {
            emit({ type: "content", delta: "\n\n" });
          }
          receivedModelContent = true;
          emit({ type: "content", delta });
        },
        onToolCall: (call) => {
          if (!call.name) return;
          if (!announcedToolCalls.has(call.index)) {
            announcedToolCalls.add(call.index);
            if (!receivedModelContent && !syntheticNarration) {
              syntheticNarration = buildToolCallNarration([{ function: { name: call.name } }]);
              emit({ type: "content", delta: syntheticNarration });
            }
            emit({ type: "tool_start", callIndex: call.index, name: call.name });
          }
          emitWriteDraft(call);
        },
      });
      usage = completion.usage || usage;
      if (completion.usage) {
        turnPromptTokens += completion.usage.prompt_tokens || 0;
        turnCompletionTokens += completion.usage.completion_tokens || 0;
      }
      const calls = completion.message.tool_calls || [];
      if (syntheticNarration) {
        const modelContent = String(completion.message.content || "").trim();
        completion.message.content = modelContent
          ? `${syntheticNarration}\n\n${modelContent}`
          : syntheticNarration;
      } else if (calls.length && !String(completion.message.content || "").trim()) {
        completion.message.content = buildToolCallNarration(calls);
        emit({ type: "content", delta: completion.message.content });
      }
      history.push(completion.message);
      await store.saveHistory(session.id, history);
      if (!calls.length || completion.finishReason !== "tool_calls") {
        finalText = completion.message.content || "Selesai.";
        const nextUsage = {
          last: {
            promptTokens: turnPromptTokens,
            completionTokens: turnCompletionTokens,
          },
          total: {
            promptTokens: (sessionUsage.total?.promptTokens || 0) + turnPromptTokens,
            completionTokens: (sessionUsage.total?.completionTokens || 0) + turnCompletionTokens,
          },
        };
        await store.update(session.id, { status: "ready", usage: nextUsage });
        emit({ type: "usage", usage: nextUsage });
        emit({ type: "assistant_end" });
        emit({ type: "done", message: finalText, usage });
        return { mutated };
      }

      for (const [callIndex, call] of calls.entries()) {
        const name = call.function?.name || "unknown";
        emitWriteDraft({
          index: callIndex,
          name,
          arguments: call.function?.arguments || "{}",
        }, true);
        if (!announcedToolCalls.has(callIndex)) {
          emit({ type: "tool_start", callIndex, name });
        }
        emit({ type: "tool_args", callIndex, name, arguments: call.function?.arguments || "{}" });
      }
      await flushStreamFrame(signal);

      for (const [callIndex, call] of calls.entries()) {
        const name = call.function?.name || "unknown";
        const { result, mutated } = await tools.execute(name, call.function?.arguments || "{}");
        if (name === "write_file") {
          const draft = extractWriteFileDraft(call.function?.arguments || "{}");
          if (draft) emit({ type: "preview_draft_clear", path: draft.path });
        }
        history.push({ role: "tool", tool_call_id: call.id, name, content: result });
        await store.saveHistory(session.id, history);
        emit({ type: "tool_result", callIndex, name, result: presentToolResult(name, result), mutated });
      }
      emit({ type: "iteration_end" });
    }
    throw new Error(`Agent mencapai batas ${config.maxIterations} iterasi`);
  } catch (error) {
    await store.update(session.id, { status: "error" });
    throw error;
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function summarize(value) {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

function presentToolResult(name, result) {
  if (result.startsWith("Error:")) return summarize(result);
  if (name === "read_file") return "File berhasil dibaca";
  if (name === "list_dir") return "Struktur workspace diperiksa";
  return summarize(result);
}

function emptyUsage() {
  return {
    last: { promptTokens: 0, completionTokens: 0 },
    total: { promptTokens: 0, completionTokens: 0 },
  };
}

async function flushStreamFrame(signal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, 50);
  });
}

function buildToolCallNarration(calls) {
  const labels = [...new Set(calls.map((call) => toolVerb(call.function?.name || "tool")))];
  if (labels.length === 1) return `${labels[0]}.`;
  if (labels.length === 2) return `${labels[0]} lalu ${labels[1]}.`;
  return `${labels.slice(0, -1).join(", ")}, lalu ${labels.at(-1)}.`;
}

function toolVerb(name) {
  return ({
    list_dir: "Saya akan memeriksa struktur workspace",
    read_file: "Saya akan membaca file yang relevan",
    write_file: "Saya akan menulis perubahan ke file",
    edit_file: "Saya akan mengedit file yang diperlukan",
    copy_file: "Saya akan menyalin file yang dibutuhkan",
  })[name] || "Saya akan menjalankan tool yang diperlukan";
}

export function extractWriteFileDraft(rawArguments) {
  const path = extractJsonStringPrefix(rawArguments, "path");
  const content = extractJsonStringPrefix(rawArguments, "content");
  if (!path?.complete || !content || !isPreviewableDraftPath(path.value)) return null;
  return { path: path.value, content: content.value };
}

function extractJsonStringPrefix(source, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(source);
  if (!match) return null;
  let value = "";
  for (let index = match.index + match[0].length; index < source.length; index++) {
    const char = source[index];
    if (char === '"') return { value, complete: true };
    if (char !== "\\") {
      value += char;
      continue;
    }
    const escaped = source[++index];
    if (escaped === undefined) return { value, complete: false };
    if (escaped === "u") {
      const hex = source.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) return { value, complete: false };
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
      continue;
    }
    value += ({ '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" })[escaped] ?? escaped;
  }
  return { value, complete: false };
}

function isPreviewableDraftPath(path) {
  const normalized = String(path).replace(/\\/g, "/");
  return !normalized.startsWith("/")
    && !/^[a-z]:/i.test(normalized)
    && !normalized.split("/").includes("..")
    && /\.(?:html?|css|js|mjs|svg)$/i.test(normalized);
}
