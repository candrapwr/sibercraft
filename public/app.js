const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  config: null,
  sessions: [],
  session: null,
  running: false,
  activeFile: null,
  previewTimer: null,
  draftPreviewTimer: null,
  lastDraftPreviewAt: 0,
  chatPanelWidth: 320,
  resizingPanel: false,
  activeAssistantTurn: null,
  activeToolBlocks: new Map(),
};

const ui = {
  sessionsView: $("#sessionsView"), workspaceView: $("#workspaceView"), aiStatus: $("#aiStatus"),
  sessionGrid: $("#sessionGrid"), emptySessions: $("#emptySessions"), sessionCount: $("#sessionCount"),
  createDialog: $("#createDialog"), createForm: $("#createForm"), workspaceName: $("#workspaceName"),
  workspaceStatus: $("#workspaceStatus"), chatMessages: $("#chatMessages"),
  usageBadge: $("#usageBadge"), usagePrompt: $("#usagePrompt"), usageCompletion: $("#usageCompletion"),
  promptForm: $("#promptForm"), promptInput: $("#promptInput"), sendButton: $("#sendButton"),
  stopButton: $("#stopButton"), previewFrame: $("#previewFrame"), previewLoading: $("#previewLoading"),
  deviceFrame: $("#deviceFrame"), filesDrawer: $("#filesDrawer"), fileList: $("#fileList"),
  workspaceMain: $(".workspace-main"), panelResizeHandle: $("#panelResizeHandle"),
  editorPane: $("#editorPane"), toast: $("#toast"), undoButton: $("#undoButton"),
  exportDialog: $("#exportDialog"), exportButton: $("#exportButton"),
  exportHtmlButton: $("#exportHtmlButton"), exportImageButton: $("#exportImageButton"),
};

boot();

async function boot() {
  bindEvents();
  try {
    [state.config, state.sessions] = await Promise.all([api("/api/config"), api("/api/sessions")]);
    renderAiStatus();
    renderSessions();
    await routeFromHash();
  } catch (error) {
    notify(error.message, true);
  }
}

function bindEvents() {
  $("#openCreateButton").addEventListener("click", openCreateDialog);
  $$('[data-create]').forEach((button) => button.addEventListener("click", openCreateDialog));
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => ui.createDialog.close()));
  ui.createForm.addEventListener("submit", createSession);
  $("#backButton").addEventListener("click", () => { location.hash = ""; });
  ui.promptForm.addEventListener("submit", sendPrompt);
  ui.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ui.promptForm.requestSubmit();
    }
  });
  ui.promptInput.addEventListener("input", autoResizePrompt);
  ui.stopButton.addEventListener("click", stopAgent);
  $("#refreshButton").addEventListener("click", () => refreshPreview());
  $("#openPreviewButton").addEventListener("click", () => window.open(previewUrl(), "_blank", "noopener"));
  $$('[data-viewport]').forEach((button) => button.addEventListener("click", () => setViewport(button)));
  $("#filesButton").addEventListener("click", openFiles);
  ui.exportButton.addEventListener("click", openExportDialog);
  $("#closeExportButton").addEventListener("click", () => ui.exportDialog.close());
  ui.exportHtmlButton.addEventListener("click", exportSingleHtml);
  ui.exportImageButton.addEventListener("click", exportFullImage);
  $("#closeFilesButton").addEventListener("click", closeFiles);
  ui.undoButton.addEventListener("click", undoChange);
  $("#deleteButton").addEventListener("click", deleteSession);
  ui.panelResizeHandle.addEventListener("pointerdown", beginPanelResize);
  ui.panelResizeHandle.addEventListener("keydown", resizePanelWithKeyboard);
  ui.previewFrame.addEventListener("load", () => { ui.previewLoading.hidden = true; });
  window.addEventListener("hashchange", routeFromHash);
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeFiles(); });
  window.addEventListener("resize", applyChatPanelWidth);
  window.addEventListener("pointermove", resizePanel);
  window.addEventListener("pointerup", endPanelResize);
  $("#previewStage").addEventListener("click", (event) => {
    if (window.innerWidth <= 680 && event.target === $("#previewStage")) ui.workspaceView.classList.remove("preview-mobile");
  });
}

async function routeFromHash() {
  const id = new URLSearchParams(location.hash.replace(/^#/, "")).get("session");
  if (!id) return showSessions();
  try {
    await openSession(id);
  } catch (error) {
    notify(error.message, true);
    location.hash = "";
  }
}

function showSessions() {
  state.session = null;
  ui.workspaceView.hidden = true;
  ui.sessionsView.hidden = false;
  document.title = "SiberCraft — AI Mockup Workspace";
  api("/api/sessions").then((sessions) => { state.sessions = sessions; renderSessions(); }).catch(() => {});
}

async function openSession(id) {
  const [session, history] = await Promise.all([
    api(`/api/sessions/${id}`),
    api(`/api/sessions/${id}/history`),
  ]);
  state.session = session;
  ui.sessionsView.hidden = true;
  ui.workspaceView.hidden = false;
  applyChatPanelWidth();
  ui.workspaceName.textContent = session.name;
  document.title = `${session.name} — SiberCraft`;
  renderHistory(history);
  renderUsage(session.usage || null);
  setWorkspaceStatus(session.status === "error" ? "error" : "ready", session.status === "error" ? "Error" : "Ready");
  ui.undoButton.disabled = !session.checkpointCount;
  autoResizePrompt();
  refreshPreview();
}

function renderAiStatus() {
  const configured = state.config?.aiConfigured;
  ui.aiStatus.className = `status-pill ${configured ? "ready" : "error"}`;
  $("span", ui.aiStatus).textContent = configured ? `${state.config.model} ready` : "API key belum diatur";
}

function renderUsage(usage) {
  if (!usage?.last) {
    ui.usageBadge.hidden = true;
    return;
  }
  ui.usageBadge.hidden = false;
  ui.usagePrompt.textContent = formatCompactTokens(usage.last.promptTokens || 0);
  ui.usageCompletion.textContent = formatCompactTokens(usage.last.completionTokens || 0);
  ui.usageBadge.title = `Turn total — prompt: ${(usage.last.promptTokens || 0).toLocaleString()} · completion: ${(usage.last.completionTokens || 0).toLocaleString()}`;
}

function resetTurnUsageDisplay() {
  if (!state.session) return;
  const usage = state.session.usage || { total: { promptTokens: 0, completionTokens: 0 } };
  state.session.usage = {
    last: { promptTokens: 0, completionTokens: 0 },
    total: usage.total || { promptTokens: 0, completionTokens: 0 },
  };
  renderUsage(state.session.usage);
}

function renderSessions() {
  ui.sessionGrid.replaceChildren();
  ui.sessionCount.textContent = `${state.sessions.length} sesi`;
  ui.emptySessions.hidden = state.sessions.length > 0;
  ui.sessionGrid.hidden = state.sessions.length === 0;
  for (const session of state.sessions) {
    const card = document.createElement("article");
    card.className = "session-card";
    card.tabIndex = 0;
    const preview = document.createElement("div");
    preview.className = "session-preview";
    const frame = document.createElement("iframe");
    frame.src = `/preview/${session.id}/?card=1`;
    frame.loading = "lazy";
    frame.setAttribute("sandbox", "");
    frame.title = `Preview ${session.name}`;
    preview.append(frame);
    const meta = document.createElement("div");
    meta.className = "session-meta";
    const copy = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = session.name;
    const date = document.createElement("p"); date.textContent = `Diedit ${formatDate(session.updatedAt)} · ${session.checkpointCount || 0} versi`;
    copy.append(title, date);
    const arrow = document.createElement("span"); arrow.className = "card-arrow"; arrow.textContent = "→";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "session-delete";
    remove.textContent = "×";
    remove.title = `Hapus sesi ${session.name}`;
    remove.setAttribute("aria-label", `Hapus sesi ${session.name}`);
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      remove.disabled = true;
      try {
        const deleted = await deleteSessionRecord(session);
        if (deleted) notify("Sesi dihapus");
      } catch (error) {
        remove.disabled = false;
        notify(error.message, true);
      }
    });
    remove.addEventListener("keydown", (event) => event.stopPropagation());
    meta.append(copy, arrow); card.append(preview, meta, remove);
    const open = () => { location.hash = `session=${session.id}`; };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
    ui.sessionGrid.append(card);
  }
}

function openCreateDialog() {
  ui.createForm.reset();
  ui.createDialog.showModal();
  setTimeout(() => $("#sessionName").focus(), 50);
}

async function createSession(event) {
  event.preventDefault();
  const submit = $('button[type="submit"]', ui.createForm);
  submit.disabled = true;
  try {
    const data = new FormData(ui.createForm);
    const session = await api("/api/sessions", { method: "POST", body: { name: data.get("name"), template: data.get("template") } });
    ui.createDialog.close();
    location.hash = `session=${session.id}`;
  } catch (error) {
    notify(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

function renderHistory(history) {
  ui.chatMessages.replaceChildren();
  state.activeAssistantTurn = null;
  state.activeToolBlocks = new Map();
  if (!history.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.innerHTML = '<span class="symbol">✦</span><h3>Apa yang ingin dibuat?</h3><p>Jelaskan interface, style, data, dan interaksi. AI akan mengubah file lalu memperbarui preview.</p>';
    ui.chatMessages.append(empty);
    return;
  }
  let toolTurn = null;
  const toolMap = new Map();
  for (const item of history) {
    if (item.role === "user") {
      appendUserMessage(item.content);
      toolTurn = null;
      toolMap.clear();
      continue;
    }
    if (item.role === "assistant") {
      const turn = createAssistantTurn(false);
      if (item.content?.trim()) appendTextBlock(turn, item.content);
      for (const call of item.toolCalls || []) {
        const block = appendToolBlock(turn, call.name, false);
        block.dataset.toolCallId = call.id || "";
        setToolArgs(block, call.arguments || "");
        toolMap.set(call.id, block);
      }
      finalizeAssistantTurn(turn);
      toolTurn = (item.toolCalls || []).length ? turn : null;
      continue;
    }
    if (item.role === "tool" && toolTurn) {
      const block = toolMap.get(item.toolCallId) || [...toolMap.values()].find((candidate) => !candidate.dataset.toolResultAttached);
      if (block) {
        setToolResult(block, item.content, true);
        block.dataset.toolResultAttached = "true";
      }
    }
  }
  scrollChat();
}

function appendUserMessage(content = "") {
  $(".chat-empty", ui.chatMessages)?.remove();
  const wrapper = document.createElement("article");
  wrapper.className = "message user";
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "YOU";
  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = content;
  wrapper.append(label, body);
  ui.chatMessages.append(wrapper);
  scrollChat();
  return wrapper;
}

function createAssistantTurn(pending = true) {
  $(".chat-empty", ui.chatMessages)?.remove();
  const wrapper = document.createElement("article");
  wrapper.className = `message assistant${pending ? " pending" : ""}`;
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "FORMA AI";
  const body = document.createElement("div");
  body.className = "message-body";
  wrapper.append(label, body);
  if (pending) body.append(createAssistantLoading());
  ui.chatMessages.append(wrapper);
  scrollChat();
  return { wrapper, body, textBlocks: [], toolBlocks: [], toolGroup: null };
}

function ensureAssistantTurn() {
  if (!state.activeAssistantTurn) state.activeAssistantTurn = createAssistantTurn(true);
  return state.activeAssistantTurn;
}

function appendTextBlock(turn, content) {
  clearThinkingState(turn);
  let block = turn.textBlocks.at(-1);
  if (!block) {
    block = createTextSegment(turn);
  }
  block.dataset.rawContent = content;
  block.innerHTML = renderMarkdown(content);
}

function appendTextDelta(delta) {
  const turn = ensureAssistantTurn();
  clearThinkingState(turn);
  let block = turn.textBlocks.at(-1);
  const current = block?.dataset.rawContent || "";
  if (!block) {
    block = createTextSegment(turn);
  }
  const next = current + delta;
  block.dataset.rawContent = next;
  block.innerHTML = renderMarkdown(next);
  scrollChat(true);
}

function createTextSegment(turn) {
  const block = document.createElement("div");
  block.className = "message-segment";
  if (turn.toolGroup?.isConnected) {
    turn.body.insertBefore(block, turn.toolGroup);
  } else {
    turn.body.append(block);
  }
  turn.textBlocks.push(block);
  return block;
}

function appendToolBlock(turn, name, running = true) {
  clearThinkingState(turn);
  const group = ensureToolGroup(turn);
  const block = document.createElement("div");
  block.className = `tool-block${running ? " running" : ""}`;
  block.innerHTML = `
    <button type="button" class="tool-head" aria-expanded="false">
      <span class="tool-chevron">⌄</span>
      <span class="tool-icon">⌘</span>
      <span class="tool-name">${escapeHtml(name)}</span>
      <span class="tool-status">${running ? renderThinkingDotsHtml() : '<span class="tool-done">done</span>'}</span>
    </button>
    <div class="tool-content" hidden>
      <pre class="tool-args"></pre>
      <div class="tool-result"><pre></pre></div>
    </div>
  `;
  const head = $(".tool-head", block);
  head.addEventListener("click", () => {
    if (block.classList.contains("running")) return;
    const expanded = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", String(!expanded));
    $(".tool-content", block).hidden = expanded;
    $(".tool-chevron", block).classList.toggle("rotated", expanded);
  });
  $(".tool-group-items", group).append(block);
  turn.toolBlocks.push(block);
  refreshToolGroup(turn);
  scrollChat(true);
  return block;
}

function appendStreamingTool(name, callIndex) {
  const turn = ensureAssistantTurn();
  const existing = state.activeToolBlocks.get(callIndex);
  if (existing) return existing;
  const block = appendToolBlock(turn, name, true);
  state.activeToolBlocks.set(callIndex, block);
  return block;
}

function setToolArgs(block, args) {
  $(".tool-args", block).textContent = args || "";
}

function setToolResult(block, result, completed = false) {
  block.classList.toggle("running", !completed);
  $(".tool-result pre", block).textContent = result || "";
  $(".tool-status", block).innerHTML = completed ? '<span class="tool-done">done</span>' : renderThinkingDotsHtml();
  refreshToolGroup(state.activeAssistantTurn);
}

function finalizeToolBlock(block, result) {
  if (!block) return;
  setToolResult(block, result, true);
}

function finalizeAssistantTurn(turn = state.activeAssistantTurn) {
  if (!turn) return;
  clearThinkingState(turn);
  refreshToolGroup(turn);
  if (!turn.body.children.length) {
    turn.wrapper.remove();
    state.activeAssistantTurn = null;
    state.activeToolBlocks = new Map();
    return;
  }
  turn.wrapper.classList.remove("pending");
  state.activeAssistantTurn = null;
  state.activeToolBlocks = new Map();
  scrollChat(true);
}

function clearThinkingState(turn) {
  turn.wrapper.classList.remove("pending");
  $(".assistant-loading", turn.body)?.remove();
}

function createAssistantLoading() {
  const block = document.createElement("div");
  block.className = "assistant-loading";
  block.innerHTML = `
    <div class="assistant-loading-icon">✦</div>
    <div class="assistant-loading-copy">
      <div class="assistant-loading-title">AI is preparing the next step</div>
      <div class="assistant-loading-meta">Waiting for response or tool call…</div>
    </div>
    ${renderThinkingDotsHtml()}
  `;
  return block;
}

function ensureToolGroup(turn) {
  if (turn.toolGroup?.isConnected) return turn.toolGroup;
  const group = document.createElement("section");
  group.className = "tool-group";
  group.innerHTML = `
    <button type="button" class="tool-group-head" aria-expanded="false">
      <span class="tool-group-title">Tool calls</span>
      <span class="tool-group-meta"></span>
      <span class="tool-group-status"></span>
      <span class="tool-group-chevron">⌄</span>
    </button>
    <div class="tool-group-items" hidden></div>
  `;
  const head = $(".tool-group-head", group);
  head.addEventListener("click", () => {
    const expanded = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", String(!expanded));
    $(".tool-group-items", group).hidden = expanded;
    $(".tool-group-chevron", group).classList.toggle("rotated", !expanded);
  });
  turn.body.append(group);
  turn.toolGroup = group;
  return group;
}

function refreshToolGroup(turn) {
  if (!turn?.toolGroup) return;
  const total = turn.toolBlocks.length;
  if (!total) return;
  const running = turn.toolBlocks.filter((block) => block.classList.contains("running")).length;
  $(".tool-group-meta", turn.toolGroup).textContent = running
    ? `${total} tools • ${running} running`
    : `${total} tools`;
  $(".tool-group-status", turn.toolGroup).innerHTML = running
    ? renderThinkingDotsHtml()
    : '<span class="tool-done">done</span>';
}

function createThinkingDots() {
  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";
  return dots;
}

function renderThinkingDotsHtml() {
  return '<span class="thinking-dots"><span></span><span></span><span></span></span>';
}

async function sendPrompt(event) {
  event.preventDefault();
  if (state.running || !state.session) return;
  const prompt = ui.promptInput.value.trim();
  if (!prompt) return;
  if (!state.config?.aiConfigured) return notify("Isi DEEPSEEK_API_KEY di file .env lalu restart server", true);

  state.running = true;
  setRunningUi(true);
  appendUserMessage(prompt);
  ui.promptInput.value = "";
  autoResizePrompt();
  resetTurnUsageDisplay();
  let bufferedDelta = "";
  let streamRenderFrame = null;
  let sawAssistantOutput = false;
  const flushBufferedContent = () => {
    if (streamRenderFrame) {
      cancelAnimationFrame(streamRenderFrame);
      streamRenderFrame = null;
    }
    if (!bufferedDelta) return;
    const delta = bufferedDelta;
    bufferedDelta = "";
    appendTextDelta(delta);
  };
  setWorkspaceStatus("working", "AI working");

  try {
    const response = await fetch(`/api/sessions/${state.session.id}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }),
    });
    if (!response.ok) throw new Error((await response.json()).error || `Request gagal (${response.status})`);
    await readNdjson(response.body, (eventData) => {
      if (eventData.type === "assistant_start") {
        ensureAssistantTurn();
        sawAssistantOutput = true;
      } else if (eventData.type === "content") {
        sawAssistantOutput = true;
        bufferedDelta += eventData.delta;
        if (!streamRenderFrame) {
          streamRenderFrame = requestAnimationFrame(() => {
            streamRenderFrame = null;
            appendTextDelta(bufferedDelta);
            bufferedDelta = "";
            scrollChat(true);
          });
        }
      } else if (eventData.type === "tool_start") {
        flushBufferedContent();
        sawAssistantOutput = true;
        appendStreamingTool(eventData.name, eventData.callIndex);
        setWorkspaceStatus("working", toolLabel(eventData.name));
      } else if (eventData.type === "tool_args") {
        flushBufferedContent();
        const tool = state.activeToolBlocks.get(eventData.callIndex);
        if (tool) setToolArgs(tool, eventData.arguments);
      } else if (eventData.type === "tool_result") {
        flushBufferedContent();
        const tool = state.activeToolBlocks.get(eventData.callIndex);
        finalizeToolBlock(tool, eventData.result);
        state.activeToolBlocks.delete(eventData.callIndex);
        if (eventData.mutated) schedulePreview();
      } else if (eventData.type === "iteration_end") {
        finalizeAssistantTurn();
      } else if (eventData.type === "assistant_end") {
        finalizeAssistantTurn();
      } else if (eventData.type === "context_optimized") {
        notify(`Konteks diringkas ${formatBytes(eventData.bytesSaved)} agar chat panjang tetap efisien`);
      } else if (eventData.type === "usage") {
        state.session.usage = eventData.usage;
        renderUsage(eventData.usage);
      } else if (eventData.type === "preview") {
        schedulePreview();
      } else if (eventData.type === "preview_draft") {
        scheduleDraftPreview();
        setWorkspaceStatus("working", "Live draft");
      } else if (eventData.type === "preview_draft_clear") {
        schedulePreview();
      } else if (eventData.type === "done") {
        flushBufferedContent();
        if (!sawAssistantOutput && eventData.message) {
          const turn = createAssistantTurn(false);
          appendTextBlock(turn, eventData.message);
          finalizeAssistantTurn(turn);
        }
      } else if (eventData.type === "error") {
        throw new Error(eventData.message);
      }
    });
    flushBufferedContent();
    finalizeAssistantTurn();
    setWorkspaceStatus("ready", "Ready");
    state.session.checkpointCount = (state.session.checkpointCount || 0) + 1;
    ui.undoButton.disabled = false;
    refreshPreview();
  } catch (error) {
    flushBufferedContent();
    finalizeAssistantTurn();
    const turn = createAssistantTurn(false);
    appendTextBlock(turn, `Tidak dapat menyelesaikan proses: ${error.message}`);
    finalizeAssistantTurn(turn);
    setWorkspaceStatus("error", "Error");
    notify(error.message, true);
    refreshPreview();
  } finally {
    state.running = false;
    setRunningUi(false);
    autoResizePrompt();
    ui.promptInput.focus();
  }
}

function setRunningUi(running) {
  ui.promptInput.disabled = running;
  ui.sendButton.hidden = running;
  ui.stopButton.hidden = !running;
  ui.undoButton.disabled = running || !state.session?.checkpointCount;
  ui.exportButton.disabled = running;
}

function openExportDialog() {
  if (!state.session || state.running) return;
  ui.exportDialog.showModal();
}

async function exportSingleHtml() {
  if (!state.session || state.running) return;
  ui.exportHtmlButton.disabled = true;
  try {
    const response = await fetch(`/api/sessions/${state.session.id}/export/html`);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Export HTML gagal");
    downloadBlob(await response.blob(), `${safeDownloadName(state.session.name)}.html`);
    ui.exportDialog.close();
    notify("Single HTML berhasil diexport");
  } catch (error) {
    notify(error.message, true);
  } finally {
    ui.exportHtmlButton.disabled = false;
  }
}

async function exportFullImage() {
  if (!state.session || state.running) return;
  ui.exportDialog.close();
  ui.exportImageButton.disabled = true;
  ui.exportButton.disabled = true;
  const width = Math.max(390, Math.round(ui.deviceFrame.getBoundingClientRect().width));
  setWorkspaceStatus("working", "Exporting image");
  notify("Screenshot sedang diproses");
  try {
    const response = await fetch(`/api/sessions/${state.session.id}/export/image?width=${width}`);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Export gambar gagal");
    downloadBlob(await response.blob(), `${safeDownloadName(state.session.name)}.png`);
    setWorkspaceStatus("ready", "Ready");
    notify("Full-page image berhasil diexport");
  } catch (error) {
    setWorkspaceStatus("error", "Export error");
    notify(error.message, true);
  } finally {
    ui.exportImageButton.disabled = false;
    ui.exportButton.disabled = false;
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeDownloadName(value) {
  return String(value || "sibercraft-export").trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "sibercraft-export";
}

async function stopAgent() {
  if (!state.session) return;
  try { await api(`/api/sessions/${state.session.id}/stop`, { method: "POST" }); }
  catch (error) { notify(error.message, true); }
}

function schedulePreview() {
  clearTimeout(state.previewTimer);
  clearTimeout(state.draftPreviewTimer);
  state.draftPreviewTimer = null;
  state.previewTimer = setTimeout(() => refreshPreview(), 350);
}

function scheduleDraftPreview() {
  const interval = 180;
  const elapsed = Date.now() - state.lastDraftPreviewAt;
  if (elapsed >= interval) {
    state.lastDraftPreviewAt = Date.now();
    refreshPreview({ silent: true });
    return;
  }
  if (state.draftPreviewTimer) return;
  state.draftPreviewTimer = setTimeout(() => {
    state.draftPreviewTimer = null;
    state.lastDraftPreviewAt = Date.now();
    refreshPreview({ silent: true });
  }, interval - elapsed);
}

function refreshPreview({ silent = false } = {}) {
  if (!state.session) return;
  if (!silent) ui.previewLoading.hidden = false;
  ui.previewFrame.src = previewUrl();
}

function autoResizePrompt() {
  ui.promptInput.style.height = "0px";
  const nextHeight = Math.min(120, Math.max(44, ui.promptInput.scrollHeight));
  ui.promptInput.style.height = `${nextHeight}px`;
}

function applyChatPanelWidth() {
  if (window.innerWidth <= 680) {
    ui.workspaceMain.style.removeProperty("--chat-panel-width");
    return;
  }
  ui.workspaceMain.style.setProperty("--chat-panel-width", `${state.chatPanelWidth}px`);
}

function beginPanelResize(event) {
  if (window.innerWidth <= 680) return;
  state.resizingPanel = true;
  document.body.classList.add("resizing-panel");
  ui.panelResizeHandle.setPointerCapture(event.pointerId);
}

function resizePanel(event) {
  if (!state.resizingPanel || window.innerWidth <= 680) return;
  const min = 260;
  const max = Math.min(520, Math.max(320, Math.round(window.innerWidth * 0.48)));
  state.chatPanelWidth = Math.min(max, Math.max(min, event.clientX));
  applyChatPanelWidth();
}

function endPanelResize(event) {
  if (!state.resizingPanel) return;
  state.resizingPanel = false;
  document.body.classList.remove("resizing-panel");
  if (event?.pointerId !== undefined && ui.panelResizeHandle.hasPointerCapture(event.pointerId)) {
    ui.panelResizeHandle.releasePointerCapture(event.pointerId);
  }
}

function resizePanelWithKeyboard(event) {
  if (window.innerWidth <= 680) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  state.chatPanelWidth += event.key === "ArrowLeft" ? -24 : 24;
  state.chatPanelWidth = Math.min(520, Math.max(260, state.chatPanelWidth));
  applyChatPanelWidth();
}

function previewUrl() {
  return state.session ? `/preview/${state.session.id}/?v=${Date.now()}` : "about:blank";
}

function setViewport(button) {
  $$('[data-viewport]').forEach((item) => item.classList.toggle("active", item === button));
  ui.deviceFrame.className = `device-frame ${button.dataset.viewport}`;
}

async function openFiles() {
  if (!state.session) return;
  ui.filesDrawer.classList.add("open");
  ui.filesDrawer.setAttribute("aria-hidden", "false");
  try { renderFiles(await api(`/api/sessions/${state.session.id}/files`)); }
  catch (error) { notify(error.message, true); }
}

function closeFiles() {
  ui.filesDrawer.classList.remove("open");
  ui.filesDrawer.setAttribute("aria-hidden", "true");
}

function renderFiles(files) {
  ui.fileList.replaceChildren();
  for (const file of files) {
    const button = document.createElement("button");
    button.textContent = file.path;
    button.title = `${file.path} · ${formatBytes(file.size)}`;
    button.addEventListener("click", () => openFile(file.path, button));
    ui.fileList.append(button);
  }
}

async function openFile(path, button) {
  try {
    const file = await api(`/api/sessions/${state.session.id}/file?path=${encodeURIComponent(path)}`);
    state.activeFile = path;
    $$("button", ui.fileList).forEach((item) => item.classList.toggle("active", item === button));
    ui.editorPane.replaceChildren();
    const head = document.createElement("div"); head.className = "editor-head";
    const label = document.createElement("span"); label.textContent = path;
    const save = document.createElement("button"); save.className = "editor-save"; save.textContent = "Save";
    const editor = document.createElement("textarea"); editor.className = "code-editor"; editor.value = file.content; editor.spellcheck = false;
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Tab") { event.preventDefault(); const start = editor.selectionStart; editor.setRangeText("  ", start, editor.selectionEnd, "end"); }
      if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); save.click(); }
    });
    save.addEventListener("click", () => saveFile(path, editor.value, save));
    head.append(label, save); ui.editorPane.append(head, editor);
  } catch (error) { notify(error.message, true); }
}

async function saveFile(path, content, button) {
  button.disabled = true;
  try {
    await api(`/api/sessions/${state.session.id}/file`, { method: "PUT", body: { path, content } });
    state.session.checkpointCount = (state.session.checkpointCount || 0) + 1;
    ui.undoButton.disabled = false;
    refreshPreview(); notify(`${path} disimpan`);
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

async function undoChange() {
  if (!state.session || state.running) return;
  ui.undoButton.disabled = true;
  try {
    await api(`/api/sessions/${state.session.id}/undo`, { method: "POST" });
    state.session.checkpointCount = Math.max(0, (state.session.checkpointCount || 1) - 1);
    const history = await api(`/api/sessions/${state.session.id}/history`);
    renderHistory(history); refreshPreview();
    if (ui.filesDrawer.classList.contains("open")) openFiles();
    notify("Perubahan terakhir dibatalkan");
  } catch (error) { notify(error.message, true); }
  finally { ui.undoButton.disabled = !state.session.checkpointCount; }
}

async function deleteSession() {
  if (!state.session || state.running) return;
  try {
    const deleted = await deleteSessionRecord(state.session);
    if (deleted) {
      location.hash = "";
      notify("Sesi dihapus");
    }
  } catch (error) { notify(error.message, true); }
}

async function deleteSessionRecord(session) {
  if (!confirm(`Hapus sesi “${session.name}” beserta semua file dan histori?`)) return false;
  await api(`/api/sessions/${session.id}`, { method: "DELETE" });
  state.sessions = state.sessions.filter((item) => item.id !== session.id);
  renderSessions();
  return true;
}

function setWorkspaceStatus(kind, label) {
  ui.workspaceStatus.className = `workspace-status ${kind}`;
  $("span", ui.workspaceStatus).textContent = label;
}

async function readNdjson(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request gagal (${response.status})`);
  return data;
}

function notify(message, error = false) {
  ui.toast.textContent = message;
  ui.toast.className = `toast show${error ? " error" : ""}`;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { ui.toast.className = "toast"; }, 3500);
}

function scrollChat(immediate = false) {
  const update = () => {
    ui.chatMessages.scrollTop = ui.chatMessages.scrollHeight;
  };
  if (immediate) update();
  else requestAnimationFrame(update);
}
function toolLabel(name) { return ({ list_dir: "Scanning files", read_file: "Reading file", write_file: "Writing file", edit_file: "Editing file", copy_file: "Copying file" })[name] || name; }
function formatDate(value) { return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatBytes(bytes) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`; }
function formatCompactTokens(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(value);
}
function renderMarkdown(value) {
  const blocks = [];
  const source = String(value || "").replace(/\r\n/g, "\n");
  const fencePattern = /```([\w-]*)\n([\s\S]*?)\n```/g;
  let cursor = 0;
  let match;

  while ((match = fencePattern.exec(source))) {
    if (match.index > cursor) blocks.push(...renderTextBlocks(source.slice(cursor, match.index)));
    blocks.push(renderCodeBlock(match[1], match[2]));
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) blocks.push(...renderTextBlocks(source.slice(cursor)));

  return blocks.join("");
}

function renderTextBlocks(text) {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^([-*•]\s.+\n?)+$/m.test(part)) {
        const items = part.split("\n").map((line) => line.replace(/^[-*•]\s+/, "").trim()).filter(Boolean);
        return `<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`;
      }
      return `<p>${part.split("\n").map((line) => renderInlineMarkdown(line)).join("<br>")}</p>`;
    });
}

function renderCodeBlock(language, code) {
  const label = escapeHtml(language || "text");
  return `<div class="code-block"><div class="code-block-label">${label}</div><pre><code>${escapeHtml(code)}</code></pre></div>`;
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
