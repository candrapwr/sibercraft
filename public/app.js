const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const MAX_IMAGE_BYTES = 1_000_000;
const LANGUAGE_STORAGE_KEY = "sibercraft-language";

const translations = {
  en: {
    appTitle: "SiberCraft — AI Mockup Workspace",
    aiChecking: "Checking AI",
    aiReady: "AI ready",
    aiNotReady: "AI not ready",
    newSession: "New project",
    startNewSession: "Start new project",
    viewWorkspace: "View project",
    continueWork: "Continue your projects",
    sectionCopy: "All conversations, previews, and resources are stored per project.",
    yourWorkspaces: "YOUR WORKSPACES",
    startCreating: "START CREATING",
    sessionCount: "{count} projects",
    createNew: "Create new",
    createFirstSession: "Create first project",
    firstWorkspaceBody: "Describe the interface you want and let the AI prepare the files and live preview.",
    backTitle: "Back to projects",
    backAria: "Back",
    statusReady: "Ready",
    statusWorking: "AI working",
    statusLiveDraft: "Live draft",
    statusExportingImage: "Exporting image",
    statusExportError: "Export error",
    statusError: "Error",
    undoTitle: "Undo the last prompt",
    undo: "Undo",
    files: "Files",
    export: "Export",
    deleteTitle: "Delete project",
    deleteAria: "Delete project",
    chatHistory: "Conversation history",
    promptPlaceholder: "Describe the mockup or use reference images...",
    addImages: "Add images",
    enterSend: "send",
    sendPrompt: "Send prompt",
    resizeChatPanel: "Resize chat panel",
    previewSize: "Preview size",
    desktop: "Desktop",
    tablet: "Tablet",
    mobile: "Mobile",
    refreshPreview: "Refresh preview",
    openInNewTab: "Open in new tab",
    loadingPreview: "Loading preview",
    selectFileSource: "Select a file to inspect the source",
    createSessionTitle: "Create project",
    sessionName: "Project name",
    sessionNameExample: "Example: Sales dashboard",
    startFrom: "Start from",
    blankCanvas: "Blank canvas",
    blankCanvasHelp: "Start from an empty page",
    dashboard: "Dashboard",
    dashboardHelp: "Basic dashboard structure",
    cancel: "Cancel",
    createSessionAction: "Create project",
    exportResult: "Export result",
    close: "Close",
    exportDescription: "Choose the format you want to download from the current preview.",
    live: "Live",
    writingInterfaceFiles: "Writing interface files",
    generatingUi: "Generating UI",
    previewUpdated: "Preview updated",
    contact: "Contact",
    sessionResource: "PROJECT RESOURCE",
    newWorkspace: "NEW WORKSPACE",
    exportProject: "EXPORT PROJECT",
    singleHtmlHelp: "All local resources are bundled into one HTML file.",
    fullPageImageHelp: "Capture the full preview as a PNG image.",
    imagePreview: "Image preview",
    closeImagePreview: "Close image preview",
    editedAt: "Edited {date} - {count} versions",
    deleteSessionConfirm: 'Delete project "{name}" with all files and history?',
    sessionDeleted: "Project deleted",
    previewCard: "Preview {name}",
    emptyChatTitle: "What do you want to build?",
    emptyChatBody: "Describe the interface, style, data, and interaction. AI will update the files and refresh the preview.",
    referenceImage: "Reference image",
    enlargeImage: "Enlarge {name}",
    maxImages: "Maximum 4 images per turn",
    unsupportedFormat: "{name} format is not supported",
    imageTooLarge: "{name} exceeds the 1 MB limit",
    imageReadFailed: "Image could not be read",
    removeImage: "Remove {name}",
    assistantPreparing: "AI is preparing the next step",
    assistantWaiting: "Waiting for response or tool call...",
    toolCalls: "Tool calls",
    done: "done",
    toolsRunning: "{total} tools - {running} running",
    toolsTotal: "{total} tools",
    multimodal: "Multimodal",
    primary: "Primary",
    imagePromptDefault: "Use these images as reference to create or update the mockup.",
    missingApiKey: "Set DEEPSEEK_API_KEY in .env then restart the server",
    multimodalUnavailable: "Multimodal AI configuration is not available",
    contextOptimized: "Context was compressed by {size} to keep long chats efficient",
    processFailed: "Could not complete the process: {message}",
    requestFailed: "Request failed ({status})",
    exportHtmlFailed: "HTML export failed",
    exportHtmlSuccess: "Single HTML exported",
    screenshotProcessing: "Screenshot is being processed",
    exportImageFailed: "Image export failed",
    exportImageSuccess: "Full-page image exported",
    save: "Save",
    fileSaved: "{path} saved",
    undoSuccess: "Last change was undone",
    toolListDir: "Scanning files",
    toolReadFile: "Reading file",
    toolWriteFile: "Writing file",
    toolEditFile: "Editing file",
    toolCopyFile: "Copying file",
    workspaceTitle: "{name} — SiberCraft",
    sessionsZero: "0 projects",
  },
  id: {
    appTitle: "SiberCraft — AI Mockup Workspace",
    aiChecking: "Memeriksa AI",
    aiReady: "AI siap",
    aiNotReady: "AI belum siap",
    newSession: "Proyek baru",
    startNewSession: "Mulai proyek baru",
    viewWorkspace: "Lihat proyek",
    continueWork: "Lanjutkan proyek",
    sectionCopy: "Semua percakapan, preview, dan resource tersimpan sesuai proyeknya.",
    yourWorkspaces: "WORKSPACE ANDA",
    startCreating: "MULAI MEMBUAT",
    sessionCount: "{count} proyek",
    createNew: "Buat baru",
    createFirstSession: "Buat proyek pertama",
    firstWorkspaceBody: "Jelaskan tampilan yang ingin dibuat dan biarkan AI menyiapkan file serta live preview-nya.",
    backTitle: "Kembali ke proyek",
    backAria: "Kembali",
    statusReady: "Ready",
    statusWorking: "AI working",
    statusLiveDraft: "Live draft",
    statusExportingImage: "Mengekspor gambar",
    statusExportError: "Export error",
    statusError: "Error",
    undoTitle: "Batalkan prompt terakhir",
    undo: "Undo",
    files: "Files",
    export: "Export",
    deleteTitle: "Hapus proyek",
    deleteAria: "Hapus proyek",
    chatHistory: "Histori percakapan",
    promptPlaceholder: "Jelaskan mockup atau gunakan gambar referensi...",
    addImages: "Tambahkan gambar",
    enterSend: "kirim",
    sendPrompt: "Kirim prompt",
    resizeChatPanel: "Ubah lebar panel chat",
    previewSize: "Ukuran preview",
    desktop: "Desktop",
    tablet: "Tablet",
    mobile: "Mobile",
    refreshPreview: "Refresh preview",
    openInNewTab: "Buka di tab baru",
    loadingPreview: "Memuat preview",
    selectFileSource: "Pilih file untuk melihat source",
    createSessionTitle: "Buat proyek",
    sessionName: "Nama proyek",
    sessionNameExample: "Contoh: Dashboard penjualan",
    startFrom: "Mulai dari",
    blankCanvas: "Blank canvas",
    blankCanvasHelp: "Mulai dari halaman kosong",
    dashboard: "Dashboard",
    dashboardHelp: "Struktur dashboard dasar",
    cancel: "Batal",
    createSessionAction: "Buat proyek",
    exportResult: "Export hasil",
    close: "Tutup",
    exportDescription: "Pilih format yang ingin diunduh dari preview saat ini.",
    live: "Live",
    writingInterfaceFiles: "Menulis file interface",
    generatingUi: "Membuat UI",
    previewUpdated: "Preview diperbarui",
    contact: "Kontak",
    sessionResource: "RESOURCE PROYEK",
    newWorkspace: "WORKSPACE BARU",
    exportProject: "EXPORT PROJECT",
    singleHtmlHelp: "Semua resource lokal digabung menjadi satu file HTML.",
    fullPageImageHelp: "Ambil screenshot penuh preview sebagai gambar PNG.",
    imagePreview: "Pratinjau gambar",
    closeImagePreview: "Tutup pratinjau gambar",
    editedAt: "Diedit {date} - {count} versi",
    deleteSessionConfirm: 'Hapus proyek "{name}" beserta semua file dan histori?',
    sessionDeleted: "Proyek dihapus",
    previewCard: "Preview {name}",
    emptyChatTitle: "Apa yang ingin dibuat?",
    emptyChatBody: "Jelaskan interface, style, data, dan interaksi. AI akan mengubah file lalu memperbarui preview.",
    referenceImage: "Gambar referensi",
    enlargeImage: "Perbesar {name}",
    maxImages: "Maksimal 4 gambar per turn",
    unsupportedFormat: "Format {name} tidak didukung",
    imageTooLarge: "{name} melebihi batas 1 MB",
    imageReadFailed: "Gambar gagal dibaca",
    removeImage: "Hapus {name}",
    assistantPreparing: "AI sedang menyiapkan langkah berikutnya",
    assistantWaiting: "Menunggu respons atau tool call...",
    toolCalls: "Tool calls",
    done: "done",
    toolsRunning: "{total} tools - {running} berjalan",
    toolsTotal: "{total} tools",
    multimodal: "Multimodal",
    primary: "Primary",
    imagePromptDefault: "Gunakan gambar ini sebagai referensi untuk membuat atau memperbarui mockup.",
    missingApiKey: "Isi DEEPSEEK_API_KEY di file .env lalu restart server",
    multimodalUnavailable: "Konfigurasi AI multimodal belum tersedia",
    contextOptimized: "Konteks diringkas {size} agar chat panjang tetap efisien",
    processFailed: "Tidak dapat menyelesaikan proses: {message}",
    requestFailed: "Request gagal ({status})",
    exportHtmlFailed: "Export HTML gagal",
    exportHtmlSuccess: "Single HTML berhasil diexport",
    screenshotProcessing: "Screenshot sedang diproses",
    exportImageFailed: "Export gambar gagal",
    exportImageSuccess: "Full-page image berhasil diexport",
    save: "Simpan",
    fileSaved: "{path} disimpan",
    undoSuccess: "Perubahan terakhir dibatalkan",
    toolListDir: "Scanning files",
    toolReadFile: "Reading file",
    toolWriteFile: "Writing file",
    toolEditFile: "Editing file",
    toolCopyFile: "Copying file",
    workspaceTitle: "{name} — SiberCraft",
    sessionsZero: "0 proyek",
  },
};

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
  pendingImages: [],
  language: "en",
  workspaceStatusKey: "statusReady",
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
  imageTray: $("#imageTray"), imageButton: $("#imageButton"), imageInput: $("#imageInput"),
  imageLightbox: $("#imageLightbox"), lightboxImage: $("#lightboxImage"),
  lightboxCaption: $("#lightboxCaption"), closeImageLightbox: $("#closeImageLightbox"),
  languageOptions: $$("[data-language-option]"),
};

let lightboxTrigger = null;

boot();

function t(key, vars = {}) {
  const table = translations[state.language] || translations.en;
  const template = table[key] ?? translations.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

function initializeLanguage() {
  const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  state.language = saved === "id" ? "id" : "en";
}

async function setLanguage(language) {
  state.language = language === "id" ? "id" : "en";
  localStorage.setItem(LANGUAGE_STORAGE_KEY, state.language);
  applyLanguage();
  if (state.session) {
    renderUsage(state.session.usage || null);
    setWorkspaceStatus(
      state.workspaceStatusKey === "statusError" || state.workspaceStatusKey === "statusExportError"
        ? "error"
        : state.workspaceStatusKey === "statusWorking" || state.workspaceStatusKey === "statusLiveDraft" || state.workspaceStatusKey === "statusExportingImage"
          ? "working"
          : "ready",
      state.workspaceStatusKey,
    );
    renderSessions();
    try {
      const history = await api(`/api/sessions/${state.session.id}/history`);
      renderHistory(history);
      if (ui.filesDrawer.classList.contains("open")) {
        renderFiles(await api(`/api/sessions/${state.session.id}/files`));
        if (state.activeFile) openFile(state.activeFile, [...$$("button", ui.fileList)].find((item) => item.textContent === state.activeFile));
      }
    } catch {}
  } else {
    renderSessions();
  }
}

function applyLanguage() {
  document.documentElement.lang = state.language;
  document.title = state.session ? t("workspaceTitle", { name: state.session.name }) : t("appTitle");
  ui.languageOptions.forEach((button) => {
    button.classList.toggle("active", button.dataset.languageOption === state.language);
  });
  applyStaticText();
}

function applyStaticText() {
  $("#openCreateButton").lastChild.textContent = t("newSession");
  $$("[data-create]").forEach((button) => {
    if (button.closest(".hero-actions")) button.lastChild.textContent = t("startNewSession");
    else if (button.closest(".section-actions")) button.textContent = `＋ ${t("createNew")}`;
    else if (button.closest(".empty-sessions")) button.lastChild.textContent = t("createFirstSession");
  });
  $(".landing-hero h1").innerHTML = state.language === "id" ? 'Dari ide menjadi<br><em>interface nyata.</em>' : 'From ideas to<br><em>real interfaces.</em>';
  $(".hero-copy").textContent = state.language === "id"
    ? "Rancang mockup, dashboard, chart, dan diagram melalui percakapan. Lihat setiap perubahan secara langsung, revisi dengan cepat, lalu export hasilnya."
    : "Design mockups, dashboards, charts, and diagrams through conversation. See every change live, revise quickly, then export the result.";
  $(".hero-actions a").childNodes[0].textContent = `${t("viewWorkspace")} `;
  $(".hero-capabilities").setAttribute("aria-label", state.language === "id" ? "Fitur utama" : "Key features");
  $(".product-message.user-preview").textContent = state.language === "id"
    ? "Buat dashboard analytics modern dengan chart dan tabel transaksi."
    : "Build a modern analytics dashboard with charts and a transaction table.";
  $(".product-live").lastChild.textContent = ` ${t("live")}`;
  $(".product-tool small").textContent = t("writingInterfaceFiles");
  $(".product-composer span").textContent = state.language === "id" ? "Jelaskan perubahan..." : "Describe the changes...";
  $(".floating-chip.chip-top").lastChild.textContent = ` ${t("generatingUi")}`;
  $(".floating-chip.chip-bottom").lastChild.textContent = ` ${t("previewUpdated")}`;
  $(".section-heading .kicker").textContent = t("yourWorkspaces");
  $(".section-heading h2").textContent = t("continueWork");
  $(".section-copy").textContent = t("sectionCopy");
  $(".empty-sessions .kicker").textContent = t("startCreating");
  $(".empty-sessions h3").textContent = state.language === "id" ? "Proyek pertama menunggu ide Anda." : "Your first project is waiting.";
  $(".empty-sessions p:not(.kicker)").textContent = t("firstWorkspaceBody");
  $(".footer-contact span").textContent = t("contact");
  $("#backButton").title = t("backTitle");
  $("#backButton").setAttribute("aria-label", t("backAria"));
  $("#undoButton").title = t("undoTitle");
  $("#undoButton span").textContent = t("undo");
  $("#filesButton span").textContent = t("files");
  $("#exportButton span").textContent = t("export");
  $("#deleteButton").title = t("deleteTitle");
  $("#deleteButton").setAttribute("aria-label", t("deleteAria"));
  ui.chatMessages.setAttribute("aria-label", t("chatHistory"));
  ui.promptInput.placeholder = t("promptPlaceholder");
  $("#imageButton").title = t("addImages");
  $("#imageButton").setAttribute("aria-label", t("addImages"));
  $(".prompt-footer > span").innerHTML = `<kbd>Enter</kbd> ${t("enterSend")}`;
  $("#sendButton").setAttribute("aria-label", t("sendPrompt"));
  $("#panelResizeHandle").setAttribute("aria-label", t("resizeChatPanel"));
  $(".viewport-tabs").setAttribute("aria-label", t("previewSize"));
  const [desktop, tablet, mobile] = $$("[data-viewport]");
  desktop.title = desktop.setAttribute("aria-label", t("desktop")) || t("desktop");
  tablet.title = tablet.setAttribute("aria-label", t("tablet")) || t("tablet");
  mobile.title = mobile.setAttribute("aria-label", t("mobile")) || t("mobile");
  $("span", desktop).textContent = t("desktop");
  $("#refreshButton").title = t("refreshPreview");
  $("#openPreviewButton").title = t("openInNewTab");
  $("#previewLoading p").textContent = t("loadingPreview");
  $(".editor-empty p").textContent = t("selectFileSource");
  $(".kicker", ui.createDialog).textContent = t("newWorkspace");
  $(".dialog-head h2", ui.createDialog).textContent = t("createSessionTitle");
  $(".field span", ui.createDialog).textContent = t("sessionName");
  $("#sessionName").placeholder = t("sessionNameExample");
  $("legend", ui.createDialog).textContent = t("startFrom");
  const templateLabels = $$(".template-options label > span");
  $("b", templateLabels[0]).textContent = t("blankCanvas");
  $("small", templateLabels[0]).textContent = t("blankCanvasHelp");
  $("b", templateLabels[1]).textContent = t("dashboard");
  $("small", templateLabels[1]).textContent = t("dashboardHelp");
  const createActions = $$(".dialog-actions button", ui.createDialog);
  createActions[0].textContent = t("cancel");
  createActions[1].childNodes[0].textContent = `${t("createSessionAction")} `;
  $(".kicker", ui.exportDialog).textContent = t("exportProject");
  $(".export-dialog .dialog-head h2").textContent = t("exportResult");
  $("#closeExportButton").setAttribute("aria-label", t("close"));
  $(".export-description").textContent = t("exportDescription");
  const exportOptions = $$(".export-option");
  $("small", exportOptions[0]).textContent = t("singleHtmlHelp");
  $("small", exportOptions[1]).textContent = t("fullPageImageHelp");
  $(".header-label", ui.filesDrawer).textContent = t("sessionResource");
  ui.imageLightbox.setAttribute("aria-label", t("imagePreview"));
  ui.closeImageLightbox.setAttribute("aria-label", t("closeImagePreview"));
  renderAiStatus();
}

async function boot() {
  initializeLanguage();
  bindEvents();
  applyLanguage();
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
  ui.languageOptions.forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.languageOption));
  });
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
  ui.imageButton.addEventListener("click", () => {
    if (!state.config?.multimodalConfigured) return notify(t("multimodalUnavailable"), true);
    ui.imageInput.click();
  });
  ui.imageInput.addEventListener("change", () => addPendingImages(ui.imageInput.files).catch((error) => notify(error.message, true)));
  ui.chatMessages.addEventListener("click", (event) => {
    const image = event.target.closest(".message-images img");
    if (image) openImageLightbox(image);
  });
  ui.chatMessages.addEventListener("keydown", (event) => {
    const image = event.target.closest(".message-images img");
    if (image && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openImageLightbox(image);
    }
  });
  ui.closeImageLightbox.addEventListener("click", closeImageLightbox);
  ui.imageLightbox.addEventListener("click", (event) => {
    if (event.target === ui.imageLightbox) closeImageLightbox();
  });
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
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!ui.imageLightbox.hidden) closeImageLightbox();
    else closeFiles();
  });
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
  document.title = t("appTitle");
  api("/api/sessions").then((sessions) => { state.sessions = sessions; renderSessions(); }).catch(() => {});
}

async function openSession(id) {
  const [session, history] = await Promise.all([
    api(`/api/sessions/${id}`),
    api(`/api/sessions/${id}/history`),
  ]);
  state.session = session;
  state.pendingImages = [];
  renderImageTray();
  ui.sessionsView.hidden = true;
  ui.workspaceView.hidden = false;
  applyChatPanelWidth();
  ui.workspaceName.textContent = session.name;
  document.title = t("workspaceTitle", { name: session.name });
  renderHistory(history);
  renderUsage(session.usage || null);
  setWorkspaceStatus(session.status === "error" ? "error" : "ready", session.status === "error" ? "statusError" : "statusReady");
  ui.undoButton.disabled = !session.checkpointCount;
  autoResizePrompt();
  refreshPreview();
}

function renderAiStatus() {
  if (!state.config) {
    ui.aiStatus.className = "status-pill";
    $("span", ui.aiStatus).textContent = t("aiChecking");
    return;
  }
  const configured = state.config.aiConfigured;
  ui.aiStatus.className = `status-pill ${configured ? "ready" : "error"}`;
  $("span", ui.aiStatus).textContent = configured ? t("aiReady") : t("aiNotReady");
}

function renderUsage(usage) {
  if (!usage?.last) {
    ui.usageBadge.hidden = true;
    return;
  }
  ui.usageBadge.hidden = false;
  ui.usagePrompt.textContent = formatCompactTokens(usage.last.promptTokens || 0);
  ui.usageCompletion.textContent = formatCompactTokens(usage.last.completionTokens || 0);
  ui.usageBadge.title = `Turn total - prompt: ${(usage.last.promptTokens || 0).toLocaleString()} - completion: ${(usage.last.completionTokens || 0).toLocaleString()}`;
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
  ui.sessionCount.textContent = state.sessions.length ? t("sessionCount", { count: state.sessions.length }) : t("sessionsZero");
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
    frame.title = t("previewCard", { name: session.name });
    const previewBadge = document.createElement("span");
    previewBadge.className = "session-preview-badge";
    previewBadge.textContent = session.template === "dashboard" ? t("dashboard") : t("blankCanvas");
    preview.append(frame, previewBadge);
    const meta = document.createElement("div");
    meta.className = "session-meta";
    const copy = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = session.name;
    const date = document.createElement("p"); date.textContent = t("editedAt", { date: formatDate(session.updatedAt), count: session.checkpointCount || 0 });
    copy.append(title, date);
    const arrow = document.createElement("span"); arrow.className = "card-arrow"; arrow.textContent = "→";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "session-delete";
    remove.textContent = "×";
    remove.title = `${t("deleteTitle")} ${session.name}`;
    remove.setAttribute("aria-label", `${t("deleteTitle")} ${session.name}`);
    remove.addEventListener("click", async (event) => {
      event.stopPropagation();
      remove.disabled = true;
      try {
        const deleted = await deleteSessionRecord(session);
        if (deleted) notify(t("sessionDeleted"));
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
    empty.innerHTML = `<span class="symbol">✦</span><h3>${escapeHtml(t("emptyChatTitle"))}</h3><p>${escapeHtml(t("emptyChatBody"))}</p>`;
    ui.chatMessages.append(empty);
    return;
  }
  let toolTurn = null;
  const toolMap = new Map();
  for (const item of history) {
    if (item.role === "user") {
      appendUserMessage(item.content, item.attachments || []);
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
      if (item.model) appendTurnModel(turn, item.model, item.aiMode);
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

function appendUserMessage(content = "", attachments = []) {
  $(".chat-empty", ui.chatMessages)?.remove();
  const wrapper = document.createElement("article");
  wrapper.className = "message user";
  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent = "YOU";
  const body = document.createElement("div");
  body.className = "message-body";
  if (attachments.length) {
    const gallery = document.createElement("div");
    gallery.className = "message-images";
    for (const attachment of attachments) {
      const image = document.createElement("img");
      image.src = attachment.url || attachment.dataUrl;
      image.alt = attachment.name || t("referenceImage");
      image.loading = "lazy";
      image.tabIndex = 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", t("enlargeImage", { name: image.alt }));
      gallery.append(image);
    }
    body.append(gallery);
  }
  if (content) {
    const text = document.createElement("div");
    text.className = "user-message-text";
    text.textContent = content;
    body.append(text);
  }
  wrapper.append(label, body);
  ui.chatMessages.append(wrapper);
  scrollChat();
  return wrapper;
}

function openImageLightbox(image) {
  lightboxTrigger = image;
  ui.lightboxImage.src = image.currentSrc || image.src;
  ui.lightboxImage.alt = image.alt || t("referenceImage");
  ui.lightboxCaption.textContent = image.alt || t("referenceImage");
  ui.imageLightbox.hidden = false;
  document.body.classList.add("lightbox-open");
  ui.closeImageLightbox.focus();
}

function closeImageLightbox() {
  if (ui.imageLightbox.hidden) return;
  ui.imageLightbox.hidden = true;
  ui.lightboxImage.removeAttribute("src");
  document.body.classList.remove("lightbox-open");
  lightboxTrigger?.focus();
  lightboxTrigger = null;
}

async function addPendingImages(fileList) {
  const files = [...(fileList || [])];
  ui.imageInput.value = "";
  if (!files.length) return;
  const remaining = 4 - state.pendingImages.length;
  if (remaining <= 0) return notify(t("maxImages"), true);
  for (const file of files.slice(0, remaining)) {
    if (!new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]).has(file.type)) {
      notify(t("unsupportedFormat", { name: file.name }), true);
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      notify(t("imageTooLarge", { name: file.name }), true);
      continue;
    }
    state.pendingImages.push({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type,
      dataUrl: await readFileAsDataUrl(file),
    });
  }
  renderImageTray();
}

function renderImageTray() {
  if (!ui.imageTray) return;
  ui.imageTray.replaceChildren();
  ui.imageTray.hidden = state.pendingImages.length === 0;
  for (const pending of state.pendingImages) {
    const item = document.createElement("div");
    item.className = "image-preview";
    const image = document.createElement("img");
    image.src = pending.dataUrl;
    image.alt = pending.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.title = t("removeImage", { name: pending.name });
    remove.addEventListener("click", () => {
      state.pendingImages = state.pendingImages.filter((image) => image.id !== pending.id);
      renderImageTray();
    });
    item.append(image, remove);
    ui.imageTray.append(item);
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error(t("imageReadFailed")));
    reader.readAsDataURL(file);
  });
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
  $(".tool-status", block).innerHTML = completed ? `<span class="tool-done">${escapeHtml(t("done"))}</span>` : renderThinkingDotsHtml();
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
      <div class="assistant-loading-title">${escapeHtml(t("assistantPreparing"))}</div>
      <div class="assistant-loading-meta">${escapeHtml(t("assistantWaiting"))}</div>
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
      <span class="tool-group-title">${escapeHtml(t("toolCalls"))}</span>
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
    ? t("toolsRunning", { total, running })
    : t("toolsTotal", { total });
  $(".tool-group-status", turn.toolGroup).innerHTML = running
    ? renderThinkingDotsHtml()
    : `<span class="tool-done">${escapeHtml(t("done"))}</span>`;
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

function appendTurnModel(turn, model, mode = "primary") {
  if (!turn || !model) return;
  $(".turn-model-info", turn.body)?.remove();
  const info = document.createElement("div");
  info.className = "turn-model-info";
  const label = mode === "multimodal" ? t("multimodal") : t("primary");
  info.textContent = `${model} · ${label}`;
  turn.body.append(info);
}

async function sendPrompt(event) {
  event.preventDefault();
  if (state.running || !state.session) return;
  const typedPrompt = ui.promptInput.value.trim();
  const images = state.pendingImages.map(({ name, type, dataUrl }) => ({ name, type, dataUrl }));
  const prompt = typedPrompt || (images.length ? t("imagePromptDefault") : "");
  if (!prompt) return;
  if (!state.config?.aiConfigured) return notify(t("missingApiKey"), true);
  if (images.length && !state.config?.multimodalConfigured) return notify(t("multimodalUnavailable"), true);

  state.running = true;
  setRunningUi(true);
  appendUserMessage(prompt, state.pendingImages.map((image) => ({ ...image, url: image.dataUrl })));
  state.pendingImages = [];
  renderImageTray();
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
  setWorkspaceStatus("working", "statusWorking");

  try {
    const response = await fetch(`/api/sessions/${state.session.id}/chat`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, images }),
    });
    if (!response.ok) throw new Error((await response.json()).error || t("requestFailed", { status: response.status }));
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
        notify(t("contextOptimized", { size: formatBytes(eventData.bytesSaved) }));
      } else if (eventData.type === "usage") {
        state.session.usage = eventData.usage;
        renderUsage(eventData.usage);
      } else if (eventData.type === "turn_model") {
        flushBufferedContent();
        appendTurnModel(ensureAssistantTurn(), eventData.model, eventData.mode);
      } else if (eventData.type === "preview") {
        schedulePreview();
      } else if (eventData.type === "preview_draft") {
        scheduleDraftPreview();
        setWorkspaceStatus("working", "statusLiveDraft");
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
    setWorkspaceStatus("ready", "statusReady");
    state.session.checkpointCount = (state.session.checkpointCount || 0) + 1;
    ui.undoButton.disabled = false;
    refreshPreview();
  } catch (error) {
    flushBufferedContent();
    finalizeAssistantTurn();
    const turn = createAssistantTurn(false);
    appendTextBlock(turn, t("processFailed", { message: error.message }));
    finalizeAssistantTurn(turn);
    setWorkspaceStatus("error", "statusError");
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
  ui.imageButton.disabled = running;
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
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || t("exportHtmlFailed"));
    downloadBlob(await response.blob(), `${safeDownloadName(state.session.name)}.html`);
    ui.exportDialog.close();
    notify(t("exportHtmlSuccess"));
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
  setWorkspaceStatus("working", "statusExportingImage");
  notify(t("screenshotProcessing"));
  try {
    const response = await fetch(`/api/sessions/${state.session.id}/export/image?width=${width}`);
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || t("exportImageFailed"));
    downloadBlob(await response.blob(), `${safeDownloadName(state.session.name)}.png`);
    setWorkspaceStatus("ready", "statusReady");
    notify(t("exportImageSuccess"));
  } catch (error) {
    setWorkspaceStatus("error", "statusExportError");
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
    const save = document.createElement("button"); save.className = "editor-save"; save.textContent = t("save");
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
    refreshPreview(); notify(t("fileSaved", { path }));
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
    notify(t("undoSuccess"));
  } catch (error) { notify(error.message, true); }
  finally { ui.undoButton.disabled = !state.session.checkpointCount; }
}

async function deleteSession() {
  if (!state.session || state.running) return;
  try {
    const deleted = await deleteSessionRecord(state.session);
    if (deleted) {
      location.hash = "";
      notify(t("sessionDeleted"));
    }
  } catch (error) { notify(error.message, true); }
}

async function deleteSessionRecord(session) {
  if (!confirm(t("deleteSessionConfirm", { name: session.name }))) return false;
  await api(`/api/sessions/${session.id}`, { method: "DELETE" });
  state.sessions = state.sessions.filter((item) => item.id !== session.id);
  renderSessions();
  return true;
}

function setWorkspaceStatus(kind, labelKey) {
  state.workspaceStatusKey = labelKey;
  ui.workspaceStatus.className = `workspace-status ${kind}`;
  $("span", ui.workspaceStatus).textContent = t(labelKey);
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
  if (!response.ok) throw new Error(data.error || t("requestFailed", { status: response.status }));
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
function toolLabel(name) { return ({ list_dir: t("toolListDir"), read_file: t("toolReadFile"), write_file: t("toolWriteFile"), edit_file: t("toolEditFile"), copy_file: t("toolCopyFile") })[name] || name; }
function formatDate(value) { return new Intl.DateTimeFormat(state.language === "id" ? "id-ID" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
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
