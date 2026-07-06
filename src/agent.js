import { createFileTools } from "./file-tools.js";
import { optimizeContext } from "./context-optimize.js";
import { DeepSeekClient } from "./deepseek.js";

const SYSTEM_PROMPT = `You are the AI frontend engineer inside the SiberCraft app.
Your job is to create and modify web mockups that run directly in the browser.

Working rules:
- All deliverables must be static web files inside the workspace: HTML, CSS, JavaScript, SVG, JSON, or related text assets.
- The workspace can hold multiple HTML files. Each preview frame in the canvas displays one HTML file. IMPORTANT: the user only sees files that have a registered frame. Before or alongside writing any HTML file the user should see, ALWAYS call create_frame({ file, device }) so a preview frame exists. If you write_file an HTML file without first registering it with create_frame, the user sees nothing until the very end. For the first action of any build task, call create_frame first, then write_file its content. Reuse an existing frame only when editing an already-shown file. Give each frame a meaningful filename (its title is derived from it). When creating a frame, pick the "device" that best matches the user's intent: "mobile"/"phone"/"app screen" -> mobile, "tablet"/"iPad" -> tablet, otherwise desktop. Default to desktop if unclear.
- If the user asks to remove a preview frame, call delete_frame. This only removes the canvas frame; it does not delete the workspace file.
- If the user asks to delete, remove, or clean up an actual workspace file or folder, call delete_file({ path, recursive }). delete_file removes the file from disk (unlike delete_frame, which only hides its preview). To delete a directory and everything inside it, set recursive=true. Never delete files you just created as part of the current task unless the user explicitly asks. If the deleted file had a frame, also call delete_frame so the canvas does not show a broken preview.
- Use read_file before changing an existing file, and use list_dir when the workspace structure is still unclear.
- Use the file tools to implement the requested work for real, not just to describe code in chat.
- When you decide to call tools, always include a short natural-language progress note before or alongside the tool call so the assistant message content is never empty.
- Produce responsive, high-quality results. Prefer semantic HTML, structured CSS, and browser-native JavaScript without a build step.
- Browser libraries over HTTPS CDN are allowed when useful for charts or diagrams, but prefer lightweight solutions first.
- For flowcharts, process flows, sequence diagrams, state diagrams, user journeys, class diagrams, ER diagrams, timelines, or similar diagram requests, use Mermaid.js by default unless the user explicitly requests another diagram library or implementation. Load Mermaid from an HTTPS CDN, use valid Mermaid syntax, initialize it in the browser, and keep the diagram responsive inside its container.
- When the current user turn includes images, inspect them carefully and use them as visual references. Recreate the relevant layout, content, colors, hierarchy, and interaction requested by the user instead of merely describing the images.
- When the user provides a website URL and asks to recreate, imitate, inspect, or take visual inspiration from it, use capture_webpage_screenshot first. The captured PNG becomes visual context on the next iteration; inspect that image before implementing the design.
- Never access secret APIs, the host filesystem, Node.js APIs, or the parent window from preview code.
- If older user messages include a [SUMMARY] block, treat it only as a record of which tools ran in that past turn. Do not assume the old file contents or tool results are still current; re-run tools when actual details are needed.
- Finish all requested changes before giving the final answer.
- The final answer must be a very short summary: Do not include implementation details, long lists, repeated explanations, suggestions, or full source code.`;

const CONVERSATION_PROMPT = `${SYSTEM_PROMPT}

This user message is normal conversation, not an instruction to change the mockup. Reply directly in a friendly, concise way in 1-3 sentences. Do not mention or imply that you inspected workspace files.`;

export function isConversationalPrompt(prompt) {
  const normalized = prompt.trim().toLowerCase().replace(/[!.,?]+$/g, "").trim();
  return /^(halo|hai|hi|hello|hey|pagi|siang|sore|malam|selamat pagi|selamat siang|selamat sore|selamat malam|terima kasih|makasih|thanks|thank you|apa kabar)$/.test(normalized);
}

export async function runAgent({ session, store, prompt, images = [], config, webScreenshot, signal, emit, onCreateFrame }) {
  const workspaceDir = store.workspaceDir(session.id);
  const hasImages = images.length > 0;
  const conversational = !hasImages && isConversationalPrompt(prompt);
  const multimodalConfigured = Boolean(config.multimodal?.apiKey && config.multimodal?.model);
  if (hasImages && !multimodalConfigured) {
    throw new Error("Model multimodal belum dikonfigurasi");
  }
  let mutated = false;
  // Track which HTML files already have a frame this turn, so auto-create
  // fires at most once per file (avoids duplicate frames when AI edits repeatedly).
  const framedFiles = new Set();

  const tools = createFileTools(workspaceDir, async (path) => {
    mutated = true;
    await store.update(session.id, { status: "working" });
    emit({ type: "preview", path });
    // Safety net: if AI writes/edits an HTML file without first calling
    // create_frame, auto-register a frame so the user sees live progress
    // instead of only the final result.
    if (onCreateFrame && /\.html?$/i.test(path) && !framedFiles.has(path)) {
      const current = await store.get(session.id);
      const hasFrame = Array.isArray(current.frames) && current.frames.some((f) => f.file === path);
      if (!hasFrame) {
        framedFiles.add(path);
        const frame = await onCreateFrame({ file: path, device: "desktop" });
        emit({ type: "frame_created", frame });
      }
    }
  }, {
    signal,
    webScreenshot: {
      enabled: Boolean(webScreenshot?.endpoint && multimodalConfigured),
      endpoint: webScreenshot?.endpoint,
    },
    onCreateFrame: onCreateFrame ? async ({ file, device }) => {
      framedFiles.add(file); // AI registered it explicitly; don't auto-create later.
      const frame = await onCreateFrame({ file, device });
      emit({ type: "frame_created", frame });
      return frame;
    } : undefined,
    onDeleteFrame: async ({ frameId, file }) => {
      mutated = true;
      await store.update(session.id, { status: "working" });
      const current = await store.get(session.id);
      const frames = Array.isArray(current.frames) ? current.frames : [];
      const target = frameId
        ? frames.find((frame) => frame.id === frameId)
        : frames.find((frame) => frame.file === file);
      if (!target) {
        throw new Error(frameId ? `Frame ${frameId} tidak ditemukan` : `Frame untuk ${file} tidak ditemukan`);
      }
      const nextFrames = await store.removeFrame(session.id, target.id);
      framedFiles.delete(target.file);
      emit({ type: "frame_deleted", frameId: target.id, file: target.file, frames: nextFrames });
      return { removed: target, frames: nextFrames };
    },
  });
  const previousHistory = await store.history(session.id);
  const history = [...previousHistory];
  const requestHistory = [];
  const sessionUsage = session.usage || emptyUsage();
  const userMessage = {
    role: "user",
    content: prompt,
    ...(images.length ? { attachments: images.map(({ name, type, path }) => ({ name, type, path })) } : {}),
  };
  const requestUserMessage = buildRequestUserMessage(prompt, images);
  history.push(userMessage);
  await store.saveHistory(session.id, history);
  await store.update(session.id, { status: "working", lastPrompt: prompt.slice(0, 140) });
  const optimizedBase = conversational
    ? { messages: previousHistory.map(toModelMessage), stats: { collapsedCount: 0, bytesSaved: 0 } }
    : optimizeContext(previousHistory, config.contextOptimize);
  if (!conversational && optimizedBase.stats.collapsedCount > 0) {
    emit({ type: "context_optimized", bytesSaved: optimizedBase.stats.bytesSaved });
  }
  await store.saveOptimizedHistory(session.id, [...optimizedBase.messages, userMessage], {
    collapsedCount: optimizedBase.stats.collapsedCount,
    bytesSaved: optimizedBase.stats.bytesSaved,
    mode: config.contextOptimize.mode,
  });

  const requestBase = () => {
    const base = [...optimizedBase.messages, requestUserMessage, ...requestHistory.map(toModelMessage)];
    return [{ role: "system", content: conversational ? CONVERSATION_PROMPT : SYSTEM_PROMPT }, ...base];
  };
  let finalText = "";
  let usage = null;
  let turnPromptTokens = 0;
  let turnCompletionTokens = 0;
  let visualContextAvailable = hasImages;
  const modelsUsed = [];

  try {
    for (let iteration = 0; iteration < config.maxIterations; iteration++) {
      const iterationAi = selectTurnAi(config, session, visualContextAvailable);
      if (visualContextAvailable && (!iterationAi.apiKey || !iterationAi.model)) {
        throw new Error("Model multimodal belum dikonfigurasi");
      }
      const client = new DeepSeekClient({
        apiKey: iterationAi.apiKey,
        baseUrl: iterationAi.baseUrl,
        model: iterationAi.model,
      });
      const lastModel = modelsUsed.at(-1);
      if (!lastModel || lastModel.model !== iterationAi.model || lastModel.mode !== iterationAi.mode) {
        modelsUsed.push({ model: iterationAi.model, mode: iterationAi.mode });
      }
      emit({ type: "status", status: iteration === 0 ? "thinking" : "working" });
      emit({ type: "iteration_model", iteration: iteration + 1, model: iterationAi.model, mode: iterationAi.mode });
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
            model: iterationAi.model,
            mode: iterationAi.mode,
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
          emit({ type: "content", delta });
        },
        onToolCall: (call) => {
          if (!call.name) return;
          if (!announcedToolCalls.has(call.index)) {
            announcedToolCalls.add(call.index);
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
      const isFinalResponse = !calls.length || completion.finishReason !== "tool_calls";
      completion.message.model = iterationAi.model;
      completion.message.ai_mode = iterationAi.mode;
      if (isFinalResponse) {
        const compact = compactFinalResponse(completion.message.content || "Selesai.");
        if (compact !== completion.message.content) {
          completion.message.content = compact;
          emit({ type: "final_content", content: compact });
        }
        completion.message.models_used = modelsUsed;
      }
      history.push(completion.message);
      requestHistory.push(completion.message);
      await store.saveHistory(session.id, history);
      if (isFinalResponse) {
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
        emit({ type: "turn_model", models: modelsUsed });
        emit({ type: "assistant_end" });
        emit({ type: "done", message: finalText, usage });
        return {
          mutated,
          // Attribution for billing/accounting: which provider footed this turn.
          // "user" = user's own BYOK key was used; "server" = operator default.
          providerSource: config._providerSource || "server",
          promptTokens: turnPromptTokens,
          completionTokens: turnCompletionTokens,
        };
      }

      await flushStreamFrame(signal);

      const capturedImages = [];
      // Execute tool calls ONE AT A TIME, emitting start/args/result per call so the
      // user can see which tool is currently processing (instead of all "started" at once).
      for (const [callIndex, call] of calls.entries()) {
        const name = call.function?.name || "unknown";
        const args = call.function?.arguments || "{}";
        // Force-flush any pending draft for this tool, then announce it right before execution.
        emitWriteDraft({ index: callIndex, name, arguments: args }, true);
        if (!announcedToolCalls.has(callIndex)) {
          emit({ type: "tool_start", callIndex, name, position: callIndex + 1, total: calls.length });
        }
        emit({ type: "tool_args", callIndex, name, arguments: args });
        await flushStreamFrame(signal);

        const { result, mutated, artifacts = [] } = await tools.execute(name, args);
        if (name === "write_file") {
          const draft = extractWriteFileDraft(args);
          if (draft) emit({ type: "preview_draft_clear", path: draft.path });
        }
        const toolMessage = { role: "tool", tool_call_id: call.id, name, content: result };
        history.push(toolMessage);
        requestHistory.push(toolMessage);
        await store.saveHistory(session.id, history);
        emit({ type: "tool_result", callIndex, name, result: presentToolResult(name, result), mutated });
        capturedImages.push(...artifacts.filter((artifact) => artifact.kind === "image" && artifact.dataUrl));
      }
      if (capturedImages.length) {
        visualContextAvailable = true;
        requestHistory.push(buildRuntimeVisualMessage(capturedImages));
      }
      emit({ type: "iteration_end" });
    }
    throw new Error(`Agent mencapai batas ${config.maxIterations} iterasi`);
  } catch (error) {
    await store.update(session.id, { status: "error" });
    throw error;
  }
}

function summarize(value) {
  return value.length > 1240 ? `${value.slice(0, 237)}...` : value;
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

export function compactFinalResponse(value, maxWords = 60, maxSentences = 3) {
  const content = String(value || "").trim();
  if (!content) return "Selesai.";
  const normalized = content.replace(/\s+/g, " ");
  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
  let result = sentences.slice(0, maxSentences).map((sentence) => sentence.trim()).join(" ");
  const words = result.split(/\s+/).filter(Boolean);
  const truncated = sentences.length > maxSentences || words.length > maxWords;
  if (words.length > maxWords) result = words.slice(0, maxWords).join(" ");
  if (truncated) result = `${result.replace(/[.!?…]+$/, "")}…`;
  return result;
}

export function buildRequestUserMessage(prompt, images = []) {
  if (!images.length) return { role: "user", content: prompt };
  return {
    role: "user",
    content: [
      { type: "text", text: prompt },
      ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
    ],
  };
}

export function buildRuntimeVisualMessage(images) {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: "Screenshot website berikut dihasilkan oleh tool pada turn ini. Analisis gambar ini sebagai referensi visual dan lanjutkan permintaan user.",
      },
      ...images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
    ],
  };
}

export function selectTurnAi(config, session, hasImages) {
  if (hasImages) return { ...config.multimodal, mode: "multimodal" };
  // Model priority for text turns:
  //   1. config.model from a user's private provider override (tagged via
  //      _providerSource === "user") — the user explicitly chose this model,
  //      so it MUST win over the session's server-default model.
  //   2. session.model — the model the session was created with (server default).
  //   3. config.model — the current server default.
  // Without this, a user who sets "deepseek-chat" in their BYOK config would
  // still be billed against the session's original "deepseek-v4-flash" model.
  const userModel = config._providerSource === "user" ? config.model : null;
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: userModel || session.model || config.model,
    mode: "primary",
  };
}

export function toModelMessage(message) {
  const clean = { role: message.role, content: message.content };
  if (message.tool_calls) clean.tool_calls = message.tool_calls;
  if (message.tool_call_id) clean.tool_call_id = message.tool_call_id;
  if (message.name) clean.name = message.name;
  // OpenAI-compatible providers prefer `content: null` (not "") for an
  // assistant turn that only contains tool calls — some reject an empty
  // string. When the model gave no narration, send null so the request
  // history stays valid across providers.
  if (clean.role === "assistant" && clean.tool_calls?.length && !String(clean.content || "").trim()) {
    clean.content = null;
  }
  return clean;
}
