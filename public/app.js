import { canvasView, onFrameCreated, onFrameDeleted, onPreviewUpdate, onDraftUpdate, onDraftClear, syncUndoState, onTurnStart, onTurnDone } from "/canvas-view.js";
import { initTooltips, setTip } from "/tooltip.js";
import { $, $$ } from "/dom.js";
import { loadLanguage, saveLanguage, translate } from "/i18n.js";
import { MAX_IMAGE_BYTES, state, ui } from "/app-state.js";
import { debounce, downloadBlob, escapeHtml, formatBytes, formatCompactTokens, readNdjson, renderMarkdown, safeDownloadName } from "/app-utils.js";

let lightboxTrigger = null;

boot();

function t(key, vars = {}) {
  return translate(state.language, key, vars);
}

function initializeLanguage() {
  state.language = loadLanguage();
}

async function setLanguage(language) {
  state.language = language === "id" ? "id" : "en";
  saveLanguage(state.language);
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
  // Landing sections: "My projects" (logged-in) + "Public projects".
  if (ui.myProjectsTitle) ui.myProjectsTitle.textContent = t("myProjectsTitle");
  if (ui.myProjectsCopy) ui.myProjectsCopy.textContent = t("myProjectsCopy");
  if (ui.communityTitle) ui.communityTitle.textContent = t("communityTitle");
  if (ui.communityKicker) ui.communityKicker.textContent = t("communityKicker");
  $("#myProjects .kicker").textContent = t("myProjectsKicker");
  // Legacy generic selector kept for sections without explicit IDs.
  const communityCopy = $("#recentSessions .section-copy");
  if (communityCopy) communityCopy.textContent = t("sectionCopy");
  ui.guestNoticeTitle.textContent = t("guestNoticeTitle");
  ui.guestNoticeBody.textContent = t("guestNoticeBody");
  ui.guestNoticeLoginButton.textContent = t("guestNoticeAction");
  $(".empty-sessions .kicker").textContent = t("startCreating");
  $(".empty-sessions h3").textContent = state.language === "id" ? "Proyek pertama menunggu ide Anda." : "Your first project is waiting.";
  $(".empty-sessions p:not(.kicker)").textContent = t("firstWorkspaceBody");
  $(".footer-contact span").textContent = t("contact");
  $("#backButton").title = t("backTitle");
  $("#backButton").setAttribute("aria-label", t("backAria"));
  setTip($("#backButton"), t("backTitle"));
  $("#undoButton").title = t("undoTitle");
  setTip($("#undoButton"), t("undoTitle"));
  $("#undoButton span").textContent = t("undo");
  $("#filesButton span").textContent = t("files");
  $("#exportButton span").textContent = t("export");
  $("#deleteButton").title = t("deleteTitle");
  setTip($("#deleteButton"), t("deleteTitle"));
  $("#deleteButton").setAttribute("aria-label", t("deleteAria"));
  ui.chatMessages.setAttribute("aria-label", t("chatHistory"));
  ui.promptInput.placeholder = t("promptPlaceholder");
  $("#imageButton").title = t("addImages");
  setTip($("#imageButton"), t("addImages"));
  $("#imageButton").setAttribute("aria-label", t("addImages"));
  $(".prompt-footer > span").innerHTML = `<kbd>Enter</kbd> ${t("enterSend")}`;
  $("#sendButton").setAttribute("aria-label", t("sendPrompt"));
  $("#panelResizeHandle").setAttribute("aria-label", t("resizeChatPanel"));
  $(".viewport-tabs").setAttribute("aria-label", t("previewSize"));
  const [desktop, tablet, mobile] = $$("[data-viewport]", $(".viewport-tabs"));
  desktop.title = desktop.setAttribute("aria-label", t("desktop")) || t("desktop");
  tablet.title = tablet.setAttribute("aria-label", t("tablet")) || t("tablet");
  mobile.title = mobile.setAttribute("aria-label", t("mobile")) || t("mobile");
  setTip(desktop, t("desktop")); setTip(tablet, t("tablet")); setTip(mobile, t("mobile"));
  $("span", desktop).textContent = t("desktop");
  $("#refreshButton").title = t("refreshPreview");
  setTip($("#refreshButton"), t("refreshPreview"));
  $("#openPreviewButton").title = t("openInNewTab");
  setTip($("#openPreviewButton"), t("openInNewTab"));
  // Canvas view static text.
  const cvBack = $("#cvBackButton");
  if (cvBack) { cvBack.title = t("backToProject"); cvBack.setAttribute("aria-label", t("backToProject")); setTip(cvBack, t("backToProject")); }
  for (const id of ["cvZoomIn", "cvCtrlZoomIn"]) { const el = $("#" + id); if (el) { el.title = t("zoomIn"); el.setAttribute("aria-label", t("zoomIn")); setTip(el, t("zoomIn")); } }
  for (const id of ["cvZoomOut", "cvCtrlZoomOut"]) { const el = $("#" + id); if (el) { el.title = t("zoomOut"); el.setAttribute("aria-label", t("zoomOut")); setTip(el, t("zoomOut")); } }
  for (const id of ["cvZoomFit", "cvCtrlZoomFit"]) { const el = $("#" + id); if (el) { el.title = t("fitAllFrames"); el.setAttribute("aria-label", t("fitAllFrames")); setTip(el, t("fitAllFrames")); } }
  const dockToggle = $("#chatDockToggle");
  if (dockToggle) { dockToggle.title = t("collapseChat"); dockToggle.setAttribute("aria-label", t("collapseChat")); setTip(dockToggle, t("collapseChat")); }
  const cvExportAll = $("#cvExportAllButton");
  if (cvExportAll) { cvExportAll.title = t("exportAll"); setTip(cvExportAll, t("exportAll")); const sp = $("span", cvExportAll); if (sp) sp.textContent = t("export"); }
  const emptyTitle = $(".canvas-empty-hint b");
  const emptyBody = $(".canvas-empty-hint span");
  if (emptyTitle) emptyTitle.textContent = t("canvasEmptyTitle");
  if (emptyBody) emptyBody.textContent = t("canvasEmptyBody");
  $("#previewLoading p").textContent = t("loadingPreview");
  $(".editor-empty p").textContent = t("selectFileSource");
  $(".kicker", ui.createDialog).textContent = t("newWorkspace");
  $(".dialog-head h2", ui.createDialog).textContent = t("createSessionTitle");
  $(".field span", ui.createDialog).textContent = t("sessionName");
  $("#sessionName").placeholder = t("sessionNameExample");
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
  ui.closeAuthButton.setAttribute("aria-label", t("close"));
  applyApiSettingsStaticText();
  applyGlobalProviderStaticText();
  renderAiStatus();
  applySessionHeading();
}

/* Translate the API settings dialog's static text. Called from applyStaticText
   so the dialog follows the active language (EN/ID). Dynamic field values
   (key/endpoint/model/usage) are populated separately in openApiSettingsDialog. */
function applyApiSettingsStaticText() {
  if (!ui.apiSettingsDialog) return;
  const dialog = ui.apiSettingsDialog;
  $(".kicker", dialog).textContent = t("apiSettingsKicker");
  $(".dialog-head h2", dialog).textContent = t("apiSettingsTitle");
  $(".api-settings-description", dialog).textContent = t("apiSettingsDesc");
  $(".api-security-text strong", dialog).textContent = t("apiSecurityTitle");
  $(".api-security-text small", dialog).textContent = t("apiSecurityBody");
  $(".api-toggle-text strong", dialog).textContent = t("apiUseOwnProvider");
  // Toggle subtext reflects the current source. We can only know which after
  // the dialog is opened (server data); until then show the default hint.
  // populateApiSettings() re-sets this with the correct text on open.
  const primaryHasKey = ui.apiSettingsPrimaryKey?.placeholder?.includes("•");
  $(".api-toggle-text small", dialog).textContent = primaryHasKey
    ? t("apiSourcePrivate")
    : t("apiSourceServer");
  // Menu item label in the user dropdown.
  if (ui.apiSettingsButton) ui.apiSettingsButton.textContent = `⚿ ${t("apiSettingsMenu")}`;
  // Fieldset legends + hints.
  const groups = $$(".api-provider-group", dialog);
  if (groups[0]) {
    $("legend", groups[0]).childNodes[0].textContent = ` ${t("apiPrimaryLegend")} `;
    const hint = $("legend small", groups[0]);
    if (hint) hint.textContent = t("apiPrimaryLegendHint");
  }
  if (groups[1]) {
    $("legend", groups[1]).childNodes[0].textContent = ` ${t("apiMultimodalLegend")} `;
    const hint = $("legend small", groups[1]);
    if (hint) hint.textContent = t("apiMultimodalLegendHint");
  }
  // Field labels + placeholders (only for fields that aren't currently holding
  // a "stored" key marker, which setApiKeyFieldState manages separately).
  $$(".api-provider-group .field > span", dialog).forEach((label, index) => {
    // Fields alternate: API key, Endpoint, Model (per group).
    if (index % 3 === 0) label.textContent = t("apiKeyLabel");
    else if (index % 3 === 1) label.textContent = t("apiEndpointLabel");
    else label.textContent = t("apiModelLabel");
  });
  // Endpoints & models (skip key fields — their placeholder is dynamic).
  setPlaceholderIfEmpty(ui.apiSettingsPrimaryEndpoint, t("apiEndpointPlaceholder"));
  setPlaceholderIfEmpty(ui.apiSettingsPrimaryModel, t("apiModelPlaceholder"));
  setPlaceholderIfEmpty(ui.apiSettingsMultimodalEndpoint, t("apiEndpointPlaceholder"));
  setPlaceholderIfEmpty(ui.apiSettingsMultimodalModel, t("apiModelPlaceholder"));
  // API-key field placeholders: keep the "stored" marker as-is; otherwise
  // re-apply the localized empty placeholder.
  for (const input of [ui.apiSettingsPrimaryKey, ui.apiSettingsMultimodalKey]) {
    if (input && !input.placeholder.includes("•")) input.placeholder = t("apiKeyPlaceholder");
  }
  // Usage panel labels.
  const usageKicker = $("[data-api-usage] .kicker");
  if (usageKicker) usageKicker.textContent = t("apiConsumptionKicker");
  const statLabels = $$("[data-api-usage] .api-usage-stat small");
  if (statLabels[0]) statLabels[0].textContent = t("apiPromptTokens");
  if (statLabels[1]) statLabels[1].textContent = t("apiCompletionTokens");
  if (statLabels[2]) statLabels[2].textContent = t("apiTurns");
  // Dialog action buttons.
  const actions = $$(".dialog-actions button", dialog);
  if (actions[0]) actions[0].textContent = t("cancel");
  if (actions[1]) actions[1].childNodes[0].textContent = `${t("apiSaveSettings")} `;
}

/** Translate the admin global-provider panel's static text on language change. */
function applyGlobalProviderStaticText() {
  if (!ui.adminProviderPanel) return;
  const title = $("#globalProviderTitle");
  if (title) title.textContent = t("globalProviderTitle");
  const desc = $("#globalProviderDesc");
  if (desc) desc.textContent = t("globalProviderDesc");
  const toggleLabel = $("#globalProviderToggle");
  if (toggleLabel) toggleLabel.textContent = t("globalProviderToggle");
}

function setPlaceholderIfEmpty(input, placeholder) {
  if (input && !input.placeholder) input.placeholder = placeholder;
}

/* ===== Auth ===== */
function hideAllTopViews() {
  ui.authView.hidden = true;
  ui.verifyView.hidden = true;
  ui.adminView.hidden = true;
  ui.sessionsView.hidden = true;
  ui.workspaceView.hidden = true;
}

function showAuthView(tab = "login") {
  state.authView = tab === "register" ? "register" : "login";
  closeOpenDialogs();
  hideAllTopViews();
  ui.authView.hidden = false;
  ui.authError.hidden = true;
  ui.registerSuccess.hidden = true;
  ui.loginNotice.hidden = true;
  const isRegister = state.authView === "register";
  ui.loginForm.hidden = isRegister;
  ui.registerForm.hidden = !isRegister;
  ui.authTabs.hidden = false;
  ui.authTabLogin.classList.toggle("active", !isRegister);
  ui.authTabRegister.classList.toggle("active", isRegister);
  ui.authTabLogin.setAttribute("aria-selected", String(!isRegister));
  ui.authTabRegister.setAttribute("aria-selected", String(isRegister));
  document.title = t("appTitle");
  history.replaceState(null, "", location.pathname);
  setTimeout(() => (isRegister ? ui.registerEmail : ui.loginEmail).focus(), 50);
}

function closeOpenDialogs() {
  for (const dialog of [ui.createDialog, ui.exportDialog]) {
    if (dialog?.open) dialog.close();
  }
}

async function closeAuthView() {
  ui.authView.hidden = true;
  await enterApp();
}

function showRegisterSuccess(email) {
  setAuthError("");
  ui.loginForm.hidden = true;
  ui.registerForm.hidden = true;
  ui.authTabs.hidden = true;
  ui.registerSuccessBody.innerHTML = t("registerSuccessBody", { email: `<strong>${escapeHtml(email)}</strong>` });
  ui.registerSuccess.hidden = false;
  ui.registerSuccessButton.focus();
}

function showLoginNotice(message) {
  ui.loginNotice.innerHTML = message;
  ui.loginNotice.hidden = !message;
}

async function showVerifyView(token) {
  hideAllTopViews();
  ui.verifyView.hidden = false;
  ui.verifyError.hidden = true;
  ui.verifyForm.hidden = false;
  state.verifyEmail = "";
  try {
    const info = await api(`/api/auth/verify-info?token=${encodeURIComponent(token)}`);
    if (!info.valid) {
      ui.verifyTitle.textContent = t("verifyInvalidTitle");
      ui.verifyInfo.textContent = t("verifyInvalidBody");
      ui.verifyForm.hidden = true;
      return;
    }
    state.verifyEmail = info.email;
    ui.verifyTitle.textContent = t("verifySetTitle");
    ui.verifyInfo.textContent = t("verifySetBody", { email: info.email });
    setTimeout(() => ui.verifyPassword.focus(), 50);
  } catch (error) {
    ui.verifyTitle.textContent = t("verifyInvalidTitle");
    ui.verifyInfo.textContent = error.message;
    ui.verifyForm.hidden = true;
  }
}

function setAuthError(message) {
  ui.authError.textContent = message;
  ui.authError.hidden = !message;
}

let authLoadingTimer = null;
function setAuthLoading(button, loading, loadingText) {
  clearTimeout(authLoadingTimer);
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add("is-loading");
    let dots = 0;
    const tick = () => {
      dots = (dots + 1) % 4;
      button.innerHTML = `${loadingText}${".".repeat(dots)}`;
      authLoadingTimer = setTimeout(tick, 350);
    };
    tick();
  } else {
    button.disabled = false;
    button.classList.remove("is-loading");
    button.innerHTML = button.dataset.originalHtml || button.innerHTML;
    delete button.dataset.originalHtml;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  setAuthError("");
  const email = ui.registerEmail.value.trim();
  if (!email) return setAuthError(t("emailRequired"));
  const submit = $("#registerSubmit");
  setAuthLoading(submit, true, t("sending"));
  try {
    await api("/api/auth/register", { method: "POST", body: { email } });
    ui.registerForm.reset();
    notify(t("registerSent"));
    showRegisterSuccess(email);
  } catch (error) {
    setAuthError(error.message);
  } finally {
    setAuthLoading(submit, false);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  setAuthError("");
  const email = ui.loginEmail.value.trim();
  const password = ui.loginPassword.value;
  if (!email || !password) return setAuthError(t("emailPasswordRequired"));
  const submit = $("#loginSubmit");
  setAuthLoading(submit, true, t("signingIn"));
  try {
    const user = await api("/api/auth/login", { method: "POST", body: { email, password } });
    state.ownerId = user.id;
    applyUser(user);
    await enterApp();
  } catch (error) {
    setAuthError(error.message);
  } finally {
    setAuthLoading(submit, false);
  }
}

async function handleVerify(event) {
  event.preventDefault();
  ui.verifyError.hidden = true;
  const token = new URLSearchParams(location.search).get("verify");
  const password = ui.verifyPassword.value;
  const confirm = ui.verifyPasswordConfirm.value;
  if (password.length < 8) return showVerifyError(t("passwordTooShort"));
  if (password !== confirm) return showVerifyError(t("passwordMismatch"));
  const submit = $("#verifySubmit");
  setAuthLoading(submit, true, t("activating"));
  try {
    await api("/api/auth/set-password", { method: "POST", body: { token, password } });
    history.replaceState(null, "", location.pathname);
    showAuthView("login");
    if (state.verifyEmail) {
      ui.loginEmail.value = state.verifyEmail;
      ui.loginPassword.focus();
      showLoginNotice(t("accountActivatedNotice"));
    }
    state.verifyEmail = "";
    notify(t("accountActivated"));
  } catch (error) {
    showVerifyError(error.message);
  } finally {
    setAuthLoading(submit, false);
  }
}

function showVerifyError(message) {
  ui.verifyError.textContent = message;
  ui.verifyError.hidden = false;
}

async function handleLogout() {
  toggleUserMenu(false);
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Abaikan; tetap logout di sisi klien.
  }
  applyUser(null);
  location.hash = "";
  showAuthView("login");
}

// --- API settings (BYOK) -------------------------------------------------
// Logged-in users can configure their own AI provider key + endpoint + model.
// Keys are encrypted server-side; the API never returns plaintext, so the
// key input is left blank on load (placeholder signals "stored").

async function openApiSettingsDialog() {
  if (!state.user) return;
  // Reset inputs first so a slow network doesn't show stale data.
  ui.apiSettingsForm.reset();
  ui.apiUsagePanel.hidden = true;
  showApiSettingsNotice(null);
  ui.apiSettingsDialog.showModal();
  try {
    const [provider, usage] = await Promise.all([api("/api/me/provider"), api("/api/me/usage")]);
    populateApiSettings(provider);
    renderApiUsage(usage);
  } catch (error) {
    // If loading the dialog itself fails, the dialog is open and the global
    // toast is hidden behind it — surface the error inline instead.
    showApiSettingsNotice(error.message, "error");
  }
}

function populateApiSettings(provider) {
  ui.apiSettingsEnabled.checked = Boolean(provider?.enabled);
  // Key fields intentionally left blank — server never returns plaintext.
  // The per-field hint tells the user whether a key is stored (and that it
  // can't be shown again, only replaced or removed).
  setApiKeyFieldState(ui.apiSettingsPrimaryKey, provider?.primary?.hasKey);
  setApiKeyFieldState(ui.apiSettingsMultimodalKey, provider?.multimodal?.hasKey);
  ui.apiSettingsPrimaryEndpoint.value = provider?.primary?.baseUrl || "";
  ui.apiSettingsPrimaryModel.value = provider?.primary?.model || "";
  ui.apiSettingsMultimodalEndpoint.value = provider?.multimodal?.baseUrl || "";
  ui.apiSettingsMultimodalModel.value = provider?.multimodal?.model || "";
  // Hint in the toggle subtext reflects the active source.
  if (ui.apiUsageSource) {
    ui.apiUsageSource.textContent = provider?.enabled && provider?.primary?.hasKey
      ? t("apiSourcePrivate")
      : t("apiSourceServer");
  }
}

// Reflect whether a key is already stored for a given field. The stored key
// is never readable, so we only signal presence ("stored, hidden") and how to
// replace or remove it. `querySelector` finds the hint sibling of the input.
function setApiKeyFieldState(input, hasKey) {
  if (!input) return;
  input.value = "";
  const hint = input.parentElement?.querySelector("[data-api-key-hint]");
  if (hasKey) {
    input.placeholder = "••••••••••••";
    if (hint) { hint.hidden = false; hint.textContent = t("apiKeyStoredHidden"); }
  } else {
    input.placeholder = t("apiKeyPlaceholder");
    if (hint) { hint.hidden = true; hint.textContent = ""; }
  }
}

function renderApiUsage(usage) {
  const hasData = usage && (usage.totalPromptTokens || usage.totalCompletionTokens || usage.totalTurns);
  ui.apiUsagePanel.hidden = !hasData;
  if (!hasData) return;
  if (ui.apiUsagePrompt) ui.apiUsagePrompt.textContent = formatCompactTokens(usage.totalPromptTokens || 0);
  if (ui.apiUsageCompletion) ui.apiUsageCompletion.textContent = formatCompactTokens(usage.totalCompletionTokens || 0);
  if (ui.apiUsageTurns) ui.apiUsageTurns.textContent = String(usage.totalTurns || 0);
  if (ui.apiUsageUpdated && usage.updatedAt) {
    ui.apiUsageUpdated.textContent = `updated ${new Date(usage.updatedAt).toLocaleString()}`;
  }
}

async function saveApiSettings(event) {
  event.preventDefault();
  const submit = event.submitter;
  setAuthLoading(submit, true);
  showApiSettingsNotice(null);
  try {
    const payload = {
      enabled: ui.apiSettingsEnabled.checked,
      primary: {
        // Empty password field → "" → server keeps the previously stored key.
        apiKey: ui.apiSettingsPrimaryKey.value,
        baseUrl: ui.apiSettingsPrimaryEndpoint.value.trim(),
        model: ui.apiSettingsPrimaryModel.value.trim(),
      },
      multimodal: {
        apiKey: ui.apiSettingsMultimodalKey.value,
        baseUrl: ui.apiSettingsMultimodalEndpoint.value.trim(),
        model: ui.apiSettingsMultimodalModel.value.trim(),
      },
    };
    const updated = await api("/api/me/provider", { method: "PUT", body: payload });
    populateApiSettings(updated);
    showApiSettingsNotice(t("apiSettingsSaved"), "success");
  } catch (error) {
    showApiSettingsNotice(error.message, "error");
  } finally {
    setAuthLoading(submit, false);
  }
}

// Inline feedback inside the API settings dialog. The native <dialog> renders
// in the browser top layer, which covers the global #toast — so we show save
// and error status here instead, where the user can see it. Pass null/"" to hide.
function showApiSettingsNotice(message, kind = "success") {
  if (!ui.apiSettingsNotice) return;
  if (!message) { ui.apiSettingsNotice.hidden = true; ui.apiSettingsNotice.textContent = ""; return; }
  ui.apiSettingsNotice.hidden = false;
  ui.apiSettingsNotice.textContent = message;
  ui.apiSettingsNotice.className = `api-settings-notice ${kind === "error" ? "error" : "success"}`;
  clearTimeout(showApiSettingsNotice.timer);
  showApiSettingsNotice.timer = setTimeout(() => {
    ui.apiSettingsNotice.hidden = true;
    ui.apiSettingsNotice.textContent = "";
  }, 5000);
}

async function enterApp() {
  hideAllTopViews();
  ui.sessionsView.hidden = false;
  applyUser(state.user);
  applySessionHeading();
  try {
    [state.config, state.sessions] = await Promise.all([api("/api/config"), api("/api/sessions")]);
    renderAiStatus();
    renderSessions();
    await routeFromHash();
  } catch (error) {
    notify(error.message, true);
  }
}

// --- Inline project rename (workspace + canvas headers) -----------------
// Click the project title → it becomes a text input with ✓ save / ✕ cancel.
// Disabled for read-only projects (public projects owned by others).

function setupProjectRename() {
  // Workspace view.
  bindRenameGroup(ui.workspaceName, ui.projectRenameInput, ui.projectRenameSave, ui.projectRenameCancel);
  // Canvas view.
  bindRenameGroup(ui.cvTitle, ui.cvRenameInput, ui.cvRenameSave, ui.cvRenameCancel);
}

function bindRenameGroup(titleEl, inputEl, saveEl, cancelEl) {
  if (!titleEl || !inputEl || !saveEl || !cancelEl) return;
  const wrap = titleEl.closest(".project-title-wrap");
  titleEl.addEventListener("click", () => {
    if (state.readOnly || !state.session) return;
    enterRenameMode(titleEl, inputEl, wrap);
  });
  titleEl.addEventListener("keydown", (event) => {
    if (state.readOnly || !state.session) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      enterRenameMode(titleEl, inputEl, wrap);
    }
  });
  saveEl.addEventListener("click", () => commitRename(inputEl, wrap));
  cancelEl.addEventListener("click", () => exitRenameMode(inputEl, wrap));
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); commitRename(inputEl, wrap); }
    else if (event.key === "Escape") { event.preventDefault(); exitRenameMode(inputEl, wrap); }
  });
  // Click outside the input while editing cancels.
  inputEl.addEventListener("blur", () => {
    if (!wrap.classList.contains("editing")) return;
    // Defer so a click on ✓/✕ is processed first.
    setTimeout(() => { if (!wrap.contains(document.activeElement)) exitRenameMode(inputEl, wrap); }, 150);
  });
}

function enterRenameMode(titleEl, inputEl, wrap) {
  inputEl.value = state.session.name || "";
  wrap.classList.add("editing");
  titleEl.hidden = true;
  inputEl.parentElement.hidden = false;
  inputEl.focus();
  inputEl.select();
}

function exitRenameMode(inputEl, wrap) {
  wrap.classList.remove("editing");
  inputEl.parentElement.hidden = true;
  const titleEl = wrap.querySelector(".project-title, #workspaceName, .cv-title");
  if (titleEl) titleEl.hidden = false;
}

async function commitRename(inputEl, wrap) {
  const name = inputEl.value.trim();
  if (!name) { notify(t("projectNameRequired"), true); inputEl.focus(); return; }
  if (name === state.session.name) { exitRenameMode(inputEl, wrap); return; }
  if (!state.session?.id) return;
  try {
    const updated = await api(`/api/sessions/${state.session.id}/rename`, { method: "POST", body: { name } });
    state.session.name = updated.name;
    // Update both headers + document title so they stay in sync.
    if (ui.workspaceName) ui.workspaceName.textContent = updated.name;
    if (ui.cvTitle) ui.cvTitle.textContent = updated.name;
    document.title = t("workspaceTitle", { name: updated.name });
    exitRenameMode(inputEl, wrap);
    notify(t("projectRenamed"));
  } catch (error) {
    notify(error.message, true);
    inputEl.focus();
    inputEl.select();
  }
}

/** Ubah narasi heading community section sesuai konteks: login user vs anon. */
function applySessionHeading() {
  // Target the community section explicitly (My projects has its own labels).
  const kicker = $("#communityKicker") || $("#recentSessions .section-heading .kicker");
  const heading = $("#communityTitle") || $("#recentSessions .section-heading h2");
  const copy = $("#recentSessions .section-copy");
  if (!kicker || !heading) return;
  if (state.user) {
    kicker.textContent = t("communityKicker");
    heading.textContent = t("communityTitle");
    if (copy) copy.textContent = t("sectionCopy");
    ui.guestNotice.hidden = true;
  } else {
    kicker.textContent = t("guestMode");
    heading.textContent = t("guestHeading");
    if (copy) copy.textContent = t("guestSectionCopy");
    ui.guestNotice.hidden = false;
  }
}

function applyUser(user) {
  state.user = user || null;
  // Tentukan konteks: apakah kita sedang di app view (sessions/workspace)?
  const inApp = !ui.sessionsView.hidden || !ui.workspaceView.hidden;
  if (!user) {
    ui.userMenu.hidden = true;
    // Anon di app view tetap bisa buat project + lihat tombol login/register.
    ui.authActions.hidden = !inApp;
    return;
  }
  ui.userMenu.hidden = false;
  ui.authActions.hidden = true;
  // Tombol admin panel hanya untuk role admin.
  if (ui.adminPanelButton) ui.adminPanelButton.hidden = user.role !== "admin";
  const initial = (user.email[0] || "?").toUpperCase();
  ui.userMenuAvatar.textContent = initial;
  ui.userMenuName.textContent = user.email.split("@")[0];
  ui.userMenuEmail.textContent = user.email;
  ui.userMenuRole.textContent = user.role;
  ui.userMenuRole.className = `badge badge-role ${user.role === "admin" ? "admin" : ""}`;
  ui.userMenuTier.textContent = user.tier;
  ui.userMenuTier.className = `badge badge-tier ${user.tier}`;
}

function toggleUserMenu(open) {
  if (open === undefined) open = ui.userMenuDropdown.hidden;
  ui.userMenuDropdown.hidden = !open;
  ui.userMenuButton.setAttribute("aria-expanded", String(open));
}

/* ===== Admin panel ===== */
let adminUsers = [];
let adminErrorState = { logs: [], total: 0, limit: 50, offset: 0, filters: { errorType: "", since: "", model: "" } };

async function showAdminView() {
  if (!state.user || state.user.role !== "admin") {
    notify(t("adminOnly"), true);
    location.hash = "";
    return;
  }
  hideAllTopViews();
  ui.adminView.hidden = false;
  document.title = "Admin — SiberCraft";
  toggleUserMenu(false);
  // Load whichever admin tab is currently active (default: users).
  const activeTab = document.querySelector("[data-admin-nav].active")?.dataset.adminNav || "users";
  if (activeTab === "errors") await loadAdminErrors();
  else await loadAdminUsers();
}

async function loadAdminUsers() {
  try {
    adminUsers = await api("/api/admin/users");
    renderAdminUsers();
  } catch (error) {
    notify(error.message, true);
  }
}

/** Format tanggal aman untuk admin table (tidak throw bila invalid). */
function formatAdminDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(state.language === "id" ? "id-ID" : "en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Switch between admin panels (Users / Error logs). Toggles nav active state,
// shows/hides the corresponding panel, and loads its data.
function switchAdminTab(name) {
  if (name !== "users" && name !== "errors" && name !== "provider") return;
  $$("[data-admin-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminNav === name);
  });
  ui.adminUsersPanel.hidden = name !== "users";
  ui.adminErrorsPanel.hidden = name !== "errors";
  ui.adminProviderPanel.hidden = name !== "provider";
  if (name === "errors" && adminErrorState.logs.length === 0) loadAdminErrors();
  if (name === "users") loadAdminUsers();
  if (name === "provider") loadAdminProvider();
}

// Compute the `since` ISO cutoff from a time-range label (today/7d/30d).
function errorSinceIso(label) {
  if (!label) return undefined;
  const now = Date.now();
  if (label === "today") return new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  if (label === "7d") return new Date(now - 7 * 86400_000).toISOString();
  if (label === "30d") return new Date(now - 30 * 86400_000).toISOString();
  return undefined;
}

// --- Admin global provider (overrides .env for everyone without BYOK) ---
async function loadAdminProvider() {
  try {
    const provider = await api("/api/admin/provider");
    populateGlobalProvider(provider);
    showGlobalProviderNotice(null);
  } catch (error) {
    notify(error.message, true);
  }
}

function populateGlobalProvider(provider) {
  ui.globalProviderEnabled.checked = Boolean(provider?.enabled);
  setGlobalKeyFieldState(ui.globalProviderPrimaryKey, provider?.primary?.hasKey);
  setGlobalKeyFieldState(ui.globalProviderMultimodalKey, provider?.multimodal?.hasKey);
  ui.globalProviderPrimaryEndpoint.value = provider?.primary?.baseUrl || "";
  ui.globalProviderPrimaryModel.value = provider?.primary?.model || "";
  ui.globalProviderMultimodalEndpoint.value = provider?.multimodal?.baseUrl || "";
  ui.globalProviderMultimodalModel.value = provider?.multimodal?.model || "";
}

function setGlobalKeyFieldState(input, hasKey) {
  if (!input) return;
  input.value = "";
  const hint = input.parentElement?.querySelector("[data-global-key-hint]");
  if (hasKey) {
    input.placeholder = "••••••••••••";
    if (hint) { hint.hidden = false; hint.textContent = t("apiKeyStoredHidden"); }
  } else {
    input.placeholder = t("apiKeyPlaceholder");
    if (hint) { hint.hidden = true; hint.textContent = ""; }
  }
}

async function saveGlobalProvider(event) {
  event.preventDefault();
  const submit = event.submitter;
  setAuthLoading(submit, true);
  showGlobalProviderNotice(null);
  try {
    const payload = {
      enabled: ui.globalProviderEnabled.checked,
      primary: {
        apiKey: ui.globalProviderPrimaryKey.value,
        baseUrl: ui.globalProviderPrimaryEndpoint.value.trim(),
        model: ui.globalProviderPrimaryModel.value.trim(),
      },
      multimodal: {
        apiKey: ui.globalProviderMultimodalKey.value,
        baseUrl: ui.globalProviderMultimodalEndpoint.value.trim(),
        model: ui.globalProviderMultimodalModel.value.trim(),
      },
    };
    const updated = await api("/api/admin/provider", { method: "PUT", body: payload });
    populateGlobalProvider(updated);
    showGlobalProviderNotice(t("globalProviderSaved"), "success");
  } catch (error) {
    showGlobalProviderNotice(error.message, "error");
  } finally {
    setAuthLoading(submit, false);
  }
}

function showGlobalProviderNotice(message, kind = "success") {
  if (!ui.globalProviderNotice) return;
  if (!message) { ui.globalProviderNotice.hidden = true; ui.globalProviderNotice.textContent = ""; return; }
  ui.globalProviderNotice.hidden = false;
  ui.globalProviderNotice.textContent = message;
  ui.globalProviderNotice.className = `api-settings-notice ${kind === "error" ? "error" : "success"}`;
  clearTimeout(showGlobalProviderNotice.timer);
  showGlobalProviderNotice.timer = setTimeout(() => {
    ui.globalProviderNotice.hidden = true;
    ui.globalProviderNotice.textContent = "";
  }, 5000);
}

async function loadAdminErrors() {
  const { limit, offset, filters } = adminErrorState;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  // The model filter also accepts owner ids — backend matches model by substring
  // and owner by exact value, so we send both fields and let either match.
  if (filters.errorType) params.set("errorType", filters.errorType);
  if (filters.since) {
    const since = errorSinceIso(filters.since);
    if (since) params.set("since", since);
  }
  if (filters.model) params.set("model", filters.model);
  try {
    const data = await api(`/api/admin/errors?${params}`);
    adminErrorState.logs = data.logs || [];
    adminErrorState.total = data.total || 0;
    renderAdminErrors();
  } catch (error) {
    notify(error.message, true);
  }
}

function renderAdminErrors() {
  const body = ui.adminErrorTableBody;
  if (!body) return;
  body.replaceChildren();
  ui.adminErrorCount.textContent = `${adminErrorState.total} ${adminErrorState.total === 1 ? "entry" : "entries"}`;
  ui.adminErrorEmpty.hidden = adminErrorState.logs.length > 0;
  // Pager
  const { limit, offset, total } = adminErrorState;
  const showPager = total > limit;
  ui.adminErrorPager.hidden = !showPager;
  if (showPager) {
    ui.adminErrorPrev.disabled = offset === 0;
    ui.adminErrorNext.disabled = offset + limit >= total;
    const from = offset + 1;
    const to = Math.min(offset + limit, total);
    ui.adminErrorPageInfo.textContent = `${from}–${to} of ${total}`;
  }
  for (const log of adminErrorState.logs) body.append(renderErrorLogRow(log));
}

function renderErrorLogRow(log) {
  const tr = document.createElement("tr");
  const when = document.createElement("td");
  when.textContent = formatAdminDateTime(log.createdAt);
  const model = document.createElement("td");
  model.textContent = log.model || "—";
  model.title = log.model || "";
  const mode = document.createElement("td");
  mode.textContent = log.mode || "—";
  const provider = document.createElement("td");
  provider.textContent = log.providerSource === "user" ? "BYOK" : "server";
  const type = document.createElement("td");
  const badge = document.createElement("span");
  badge.className = `err-badge err-${(log.errorType || "unknown").toLowerCase()}`;
  badge.textContent = log.errorType || "Unknown";
  type.append(badge);
  const owner = document.createElement("td");
  owner.textContent = log.ownerId ? (log.ownerId.startsWith("anon-") ? "anon" : log.ownerId.slice(0, 8)) : "—";
  owner.title = log.ownerId || "";
  const iter = document.createElement("td");
  iter.className = "num";
  iter.textContent = log.iteration == null ? "—" : String(log.iteration);
  const msg = document.createElement("td");
  msg.className = "err-message";
  const msgText = document.createElement("span");
  msgText.textContent = log.errorMessage || "";
  msgText.title = log.errorMessage || "";
  msg.append(msgText);
  if (log.sessionId) {
    const link = document.createElement("a");
    link.href = `#session=${log.sessionId}`;
    link.className = "err-session-link";
    link.textContent = "open";
    link.title = "Open session";
    msg.append(link);
  }
  const actions = document.createElement("td");
  actions.className = "num";
  const del = document.createElement("button");
  del.type = "button";
  del.className = "admin-row-delete";
  del.textContent = "×";
  del.title = "Delete this entry";
  del.setAttribute("aria-label", "Delete error log entry");
  del.addEventListener("click", async () => {
    del.disabled = true;
    try {
      await api(`/api/admin/errors/${log.id}`, { method: "DELETE" });
      adminErrorState.logs = adminErrorState.logs.filter((x) => x.id !== log.id);
      adminErrorState.total = Math.max(0, adminErrorState.total - 1);
      renderAdminErrors();
    } catch (error) {
      del.disabled = false;
      notify(error.message, true);
    }
  });
  actions.append(del);
  tr.append(when, model, mode, provider, type, owner, iter, msg, actions);
  return tr;
}

function confirmClearAllErrors() {
  if (adminErrorState.total === 0) { notify(t("adminNoErrors")); return; }
  pendingAdminAction = { kind: "clear-errors" };
  ui.adminConfirmTitle.textContent = t("adminClearErrorsTitle");
  ui.adminConfirmBody.textContent = t("adminClearErrorsBody", { count: adminErrorState.total });
  ui.adminConfirmOk.textContent = t("adminClearConfirm");
  ui.adminConfirmDialog.showModal();
}

/** Date+time format for error log timestamps (more precise than date-only). */
function formatAdminDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const locale = state.language === "id" ? "id-ID" : "en-US";
  return d.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderAdminUsers() {
  try {
    ui.adminUserTableBody.replaceChildren();
    ui.adminUserCount.textContent = `${adminUsers.length} ${adminUsers.length === 1 ? "user" : "users"}`;
  ui.adminUserCount.textContent = `${adminUsers.length} ${adminUsers.length === 1 ? "user" : "users"}`;
  ui.adminEmpty.hidden = adminUsers.length > 0;
  const isSelf = (u) => state.user && u.id === state.user.id;
  for (const u of adminUsers) {
    const tr = document.createElement("tr");
    if (isSelf(u)) tr.classList.add("is-self");

    const emailCell = document.createElement("td");
    emailCell.innerHTML = `<span class="admin-user-email">${escapeHtml(u.email)}</span>${isSelf(u) ? '<span class="admin-you">you</span>' : ""}`;

    const roleCell = document.createElement("td");
    roleCell.innerHTML = `<span class="badge badge-role ${u.role === "admin" ? "admin" : ""}">${u.role}</span>`;

    const tierCell = document.createElement("td");
    tierCell.innerHTML = `<span class="badge badge-tier ${u.tier}">${u.tier}</span>`;

    const statusCell = document.createElement("td");
    const statusClass = u.status === "active" ? "ok" : "pending";
    statusCell.innerHTML = `<span class="admin-status admin-status-${statusClass}">●</span>${u.status}`;

    const projCell = document.createElement("td");
    projCell.className = "num";
    projCell.textContent = u.projectCount ?? 0;

    const createdCell = document.createElement("td");
    createdCell.textContent = formatAdminDate(u.createdAt);

    const actionsCell = document.createElement("td");
    actionsCell.className = "num";
    if (!isSelf(u)) {
      if (u.status !== "active") {
        const activateBtn = document.createElement("button");
        activateBtn.className = "admin-action-btn";
        activateBtn.textContent = "Activate";
        activateBtn.addEventListener("click", () => adminActivateUser(u));
        actionsCell.appendChild(activateBtn);
      }
      // Toggle role: promote to admin or demote to user.
      const roleBtn = document.createElement("button");
      roleBtn.className = "admin-action-btn";
      if (u.role === "admin") {
        roleBtn.textContent = "Make user";
        roleBtn.addEventListener("click", () => adminChangeRole(u, "user"));
      } else {
        roleBtn.textContent = "Make admin";
        roleBtn.addEventListener("click", () => adminChangeRole(u, "admin"));
      }
      actionsCell.appendChild(roleBtn);
      const delBtn = document.createElement("button");
      delBtn.className = "admin-action-btn danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", () => adminConfirmDelete(u));
      actionsCell.appendChild(delBtn);
    } else {
      actionsCell.textContent = "—";
    }

    tr.append(emailCell, roleCell, tierCell, statusCell, projCell, createdCell, actionsCell);
    ui.adminUserTableBody.appendChild(tr);
  }
  } catch (err) {
    notify(err.message, true);
  }
}

async function adminActivateUser(u) {
  try {
    const updated = await api(`/api/admin/users/${u.id}/activate`, { method: "POST" });
    Object.assign(u, updated);
    renderAdminUsers();
    notify(t("adminUserActivated", { email: u.email }));
  } catch (error) {
    notify(error.message, true);
  }
}

async function adminChangeRole(u, role) {
  const verb = role === "admin" ? t("adminPromote") : t("adminDemote");
  try {
    const updated = await api(`/api/admin/users/${u.id}`, { method: "PATCH", body: { role } });
    Object.assign(u, updated);
    renderAdminUsers();
    notify(`${verb}: ${u.email}`);
  } catch (error) {
    notify(error.message, true);
  }
}

let pendingDeleteUser = null;
// Generic pending action for the admin confirm dialog (e.g. clear error logs).
let pendingAdminAction = null;

function adminConfirmDelete(u) {
  pendingDeleteUser = u;
  ui.adminConfirmTitle.textContent = t("adminDeleteTitle", { email: u.email });
  ui.adminConfirmBody.textContent = t("adminDeleteBody", { count: u.projectCount ?? 0 });
  ui.adminConfirmOk.textContent = t("adminClearConfirm");
  ui.adminConfirmDialog.showModal();
}

async function executeAdminDelete() {
  // Dispatch by pending action kind.
  if (pendingAdminAction?.kind === "clear-errors") {
    const action = pendingAdminAction;
    pendingAdminAction = null;
    ui.adminConfirmDialog.close();
    try {
      const result = await api("/api/admin/errors", { method: "DELETE" });
      adminErrorState.logs = [];
      adminErrorState.total = 0;
      renderAdminErrors();
      notify(t("adminErrorsCleared", { count: result.removed || 0 }));
    } catch (error) {
      notify(error.message, true);
    }
    return;
  }
  const u = pendingDeleteUser;
  if (!u) return;
  ui.adminConfirmDialog.close();
  pendingDeleteUser = null;
  try {
    await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
    adminUsers = adminUsers.filter((x) => x.id !== u.id);
    renderAdminUsers();
    notify(t("adminUserDeleted", { email: u.email }));
  } catch (error) {
    notify(error.message, true);
  }
}

async function boot() {
  initializeLanguage();
  bindEvents();
  applyLanguage();
  try {
    const verifyToken = new URLSearchParams(location.search).get("verify");
    if (verifyToken) {
      showVerifyView(verifyToken);
      return;
    }
    // Coba ambil user; bila 401/cookie kedaluarsa -> mode anon (tetap pakai app).
    let user = null;
    try {
      const me = await api("/api/auth/me");
      if (me && me.isAnon) {
        // Anon: tidak ada akun, tapi punya ownerId untuk identifikasi project.
        state.ownerId = me.ownerId;
      } else {
        user = me;
        state.ownerId = me ? me.id : null;
      }
    } catch {
      user = null;
      state.ownerId = null;
    }
    applyUser(user);
    await enterApp();
  } catch (error) {
    notify(error.message, true);
  }
}

function bindEvents() {
  ui.languageOptions.forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.languageOption));
  });
  ui.authTabLogin.addEventListener("click", () => showAuthView("login"));
  ui.authTabRegister.addEventListener("click", () => showAuthView("register"));
  ui.loginForm.addEventListener("submit", handleLogin);
  ui.registerForm.addEventListener("submit", handleRegister);
  ui.verifyForm.addEventListener("submit", handleVerify);
  ui.registerSuccessButton.addEventListener("click", () => showAuthView("login"));
  ui.userMenuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleUserMenu();
  });
  ui.logoutButton.addEventListener("click", handleLogout);
  ui.adminPanelButton.addEventListener("click", () => { toggleUserMenu(false); location.hash = "admin"; });
  ui.apiSettingsButton.addEventListener("click", () => { toggleUserMenu(false); openApiSettingsDialog(); });
  ui.apiSettingsForm.addEventListener("submit", saveApiSettings);
  ui.adminBackButton.addEventListener("click", () => {
    if (location.hash) {
      history.replaceState(null, "", location.pathname + location.search);
      routeFromHash();
    } else {
      showSessions();
    }
  });
  ui.adminConfirmOk.addEventListener("click", executeAdminDelete);
  ui.adminConfirmCancel.addEventListener("click", () => { pendingDeleteUser = null; pendingAdminAction = null; ui.adminConfirmDialog.close(); });
  // Tutup dialog via Escape/backdrop bawaan tetap membatalkan.
  ui.adminConfirmDialog.addEventListener("close", () => { pendingDeleteUser = null; pendingAdminAction = null; });
  // Admin tab switching: Users / Error logs.
  $$("[data-admin-nav]").forEach((button) => {
    button.addEventListener("click", () => switchAdminTab(button.dataset.adminNav));
  });
  ui.globalProviderForm?.addEventListener("submit", saveGlobalProvider);
  // Error log filters + pagination + actions.
  ui.adminErrorFilterType?.addEventListener("change", () => { adminErrorState.offset = 0; loadAdminErrors(); });
  ui.adminErrorFilterSince?.addEventListener("change", () => { adminErrorState.offset = 0; loadAdminErrors(); });
  ui.adminErrorFilterModel?.addEventListener("input", debounce(() => { adminErrorState.offset = 0; loadAdminErrors(); }, 350));
  ui.adminErrorPrev?.addEventListener("click", () => { adminErrorState.offset = Math.max(0, adminErrorState.offset - adminErrorState.limit); loadAdminErrors(); });
  ui.adminErrorNext?.addEventListener("click", () => { adminErrorState.offset += adminErrorState.limit; loadAdminErrors(); });
  ui.adminErrorClearAll?.addEventListener("click", () => confirmClearAllErrors());
  ui.headerLoginButton.addEventListener("click", () => showAuthView("login"));
  ui.guestNoticeLoginButton.addEventListener("click", () => showAuthView("login"));
  ui.closeAuthButton.addEventListener("click", () => closeAuthView().catch((error) => notify(error.message, true)));
  document.addEventListener("click", (event) => {
    if (!ui.userMenu.hidden && !ui.userMenu.contains(event.target)) toggleUserMenu(false);
  });
  $$('[data-create]').forEach((button) => button.addEventListener("click", openCreateDialog));
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => {
    // Tutup <dialog> terdekat dari tombol ini (create, export, api-settings, dsb.).
    const dialog = button.closest("dialog");
    if (dialog) dialog.close();
  }));
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
  // Inline project rename: clicking the title opens an input + ✓ save / ✕ cancel.
  setupProjectRename();
  ui.undoButton.addEventListener("click", undoChange);
  $("#deleteButton").addEventListener("click", deleteSession);
  ui.panelResizeHandle.addEventListener("pointerdown", beginPanelResize);
  ui.panelResizeHandle.addEventListener("keydown", resizePanelWithKeyboard);
  ui.previewFrame.addEventListener("load", () => { ui.previewLoading.hidden = true; });
  window.addEventListener("hashchange", routeFromHash);
  // Saat user klik back dari canvas view → kembali ke daftar project & clear state.
  // Clear hash dulu supaya refresh tidak kembali ke session yang sudah ditinggalkan.
  window.addEventListener("sibercraft:canvas-left", () => {
    if (location.hash && location.hash.replace(/^#/, "").includes("session=")) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    showSessions();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!ui.authView.hidden) closeAuthView().catch((error) => notify(error.message, true));
    else if (!ui.imageLightbox.hidden) closeImageLightbox();
    else closeFiles();
  });
  window.addEventListener("resize", applyChatPanelWidth);
  window.addEventListener("pointermove", resizePanel);
  window.addEventListener("pointerup", endPanelResize);
  canvasView.init();
  initTooltips();
  $("#previewStage").addEventListener("click", (event) => {
    if (window.innerWidth <= 680 && event.target === $("#previewStage")) ui.workspaceView.classList.remove("preview-mobile");
  });
}

async function routeFromHash() {
  // Route admin: #admin
  if (location.hash.replace(/^#/, "") === "admin") {
    return showAdminView();
  }
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
  state.readOnly = false;
  hideAllTopViews();
  ui.sessionsView.hidden = false;
  applySessionHeading();
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
  // Read-only bila user tidak login ATAU bukan pemilik (lihat project publik orang lain).
  const isOwner = session.ownerId && session.ownerId === state.ownerId;
  const isAdmin = state.user && state.user.role === "admin";
  state.readOnly = !isOwner && !isAdmin;
  applyReadOnlyMode();
  renderImageTray();
  ui.sessionsView.hidden = true;
  ui.workspaceView.hidden = false; // chat-panel masih mount di sini, lalu dipindah ke canvas dock
  applyChatPanelWidth();
  ui.workspaceName.textContent = session.name;
  document.title = t("workspaceTitle", { name: session.name });
  renderHistory(history);
  renderUsage(session.usage || null);
  setWorkspaceStatus(session.status === "error" ? "error" : "ready", session.status === "error" ? "statusError" : "statusReady");
  ui.undoButton.disabled = state.readOnly || !session.checkpointCount;
  autoResizePrompt();
  // Langsung masuk canvas view (workspace view centered lama sudah tidak dipakai).
  enterCanvasForSession(session);
}

/** Masuk canvas view untuk session, auto-migrasi project lama tanpa frames. */
async function enterCanvasForSession(session) {
  const hasFrames = Array.isArray(session.frames) && session.frames.length > 0;
  // Hanya migrasi/bootstrap untuk project LAMA yang sudah punya history
  // (checkpointCount > 0). Project baru (kosong) biarkan kosong sampai AI bikin frame.
  const isLegacy = !hasFrames && (session.checkpointCount || 0) > 0;

  if (isLegacy && state.readOnly) {
    // Read-only (project publik orang lain): tidak boleh tulis ke server.
    // Auto-scan file .html di workspace → buat frame ephemeral di client saja.
    canvasView.enter({
      session,
      chatMount: $(".chat-panel"),
      chatResizeHandle: ui.panelResizeHandle,
    });
    await canvasView.bootstrapFromFiles(session.id);
  } else if (isLegacy) {
    // Owner + legacy: persist migration ke server (tahan lintas perangkat).
    try {
      const updated = await api(`/api/sessions/${session.id}/migrate-frames`, { method: "POST" });
      if (updated?.frames) session.frames = updated.frames;
    } catch (e) {
      // gagal migrate → fallback scan file di client di bawah
    }
    canvasView.enter({
      session,
      chatMount: $(".chat-panel"),
      chatResizeHandle: ui.panelResizeHandle,
    });
    if (!session.frames?.length) await canvasView.bootstrapFromFiles(session.id);
  } else {
    // Project baru (kosong) ATAU sudah punya frames → langsung masuk canvas apa adanya.
    canvasView.enter({
      session,
      chatMount: $(".chat-panel"),
      chatResizeHandle: ui.panelResizeHandle,
    });
  }
}

/** Aktifkan/nonaktifkan mode read-only di workspace (project publik orang lain). */
function applyReadOnlyMode() {
  const readonly = state.readOnly;
  for (const key of ["promptInput", "sendButton", "imageButton", "deleteButton", "filesButton", "exportButton"]) {
    if (ui[key]) ui[key].disabled = readonly;
  }
  // Banner read-only (dibuat di index.html).
  const banner = $("#readOnlyBanner");
  const bannerText = $("#readOnlyBannerText");
  if (banner) banner.hidden = !readonly;
  if (bannerText) bannerText.textContent = t("readOnlyBannerText");
  ui.workspaceMain?.classList.toggle("readonly-mode", readonly);
  ui.promptInput.placeholder = t(readonly ? "readOnlyPlaceholder" : "promptPlaceholder");
  // Toggle editable state on the project title wraps (rename disabled for read-only).
  const editable = !readonly && Boolean(state.session);
  ui.workspaceName?.closest(".project-title-wrap")?.classList.toggle("editable", editable);
  ui.cvTitle?.closest(".project-title-wrap")?.classList.toggle("editable", editable);
  ui.workspaceName?.setAttribute("title", editable ? t("clickToRename") : "");
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
  const badges = [
    { badge: ui.usageBadge, prompt: ui.usagePrompt, completion: ui.usageCompletion },
    { badge: $("#cvUsageBadge"), prompt: $("#cvUsagePrompt"), completion: $("#cvUsageCompletion") },
  ];
  for (const b of badges) {
    if (!b.badge) continue;
    if (!usage?.last) { b.badge.hidden = true; continue; }
    b.badge.hidden = false;
    if (b.prompt) b.prompt.textContent = formatCompactTokens(usage.last.promptTokens || 0);
    if (b.completion) b.completion.textContent = formatCompactTokens(usage.last.completionTokens || 0);
    b.badge.title = `Turn total - prompt: ${(usage.last.promptTokens || 0).toLocaleString()} - completion: ${(usage.last.completionTokens || 0).toLocaleString()}`;
  }
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
  // For logged-in users, split into two groups: their own projects (shown in a
  // dedicated "My projects" section on top) and the rest (community gallery).
  // Anonymous users see everything in one grid, as before.
  const isLoggedIn = Boolean(state.user);
  const myProjects = isLoggedIn
    ? state.sessions.filter((s) => s.ownerId && s.ownerId === state.ownerId)
    : [];
  const community = isLoggedIn
    ? state.sessions.filter((s) => !(s.ownerId && s.ownerId === state.ownerId))
    : state.sessions;

  if (isLoggedIn) {
    renderSessionGrid(ui.myProjectsGrid, ui.emptyMyProjects, ui.myProjectsCount, myProjects, false);
    renderSessionGrid(ui.sessionGrid, ui.emptySessions, ui.sessionCount, community, true);
    ui.myProjectsSection.hidden = false;
  } else {
    // Anonymous: hide "My projects" section, show everything in community grid.
    ui.myProjectsSection.hidden = true;
    renderSessionGrid(ui.sessionGrid, ui.emptySessions, ui.sessionCount, state.sessions, false);
  }
}

/**
 * Render a list of sessions into a grid element.
 * @param grid       The .session-grid container.
 * @param emptyEl    The empty-state element to toggle.
 * @param countEl    The count label element.
 * @param sessions   Sessions to render.
 * @param community  True when rendering the community gallery (controls heading labels).
 */
function renderSessionGrid(grid, emptyEl, countEl, sessions, community) {
  if (!grid) return;
  grid.replaceChildren();
  if (countEl) {
    const label = community ? "communityCount" : "sessionCount";
    countEl.textContent = sessions.length ? t(label, { count: sessions.length }) : t("sessionsZero");
  }
  if (emptyEl) emptyEl.hidden = sessions.length > 0;
  grid.hidden = sessions.length === 0;
  for (const session of sessions) grid.append(renderSessionCard(session));
}

function renderSessionCard(session) {
  const card = document.createElement("article");
  card.className = "session-card";
  card.tabIndex = 0;
  const preview = document.createElement("div");
  preview.className = "session-preview";
  const frameCount = Array.isArray(session.frames) ? session.frames.length : 0;
  const previewIcon = document.createElement("div");
  previewIcon.className = "session-preview-icon";
  previewIcon.innerHTML = `<span class="preview-grid"></span><b>${frameCount}</b><small>${frameCount === 1 ? "frame" : "frames"}</small>`;
  const previewBadge = document.createElement("span");
  previewBadge.className = "session-preview-badge";
  previewBadge.textContent = session.template === "dashboard" ? t("dashboard") : t("blankCanvas");
  preview.append(previewIcon, previewBadge);
  // Thumbnail (best-effort): bila tersedia, tampil di atas ikon grid.
  // Fallback bila 404 (belum digenerate / Chrome tidak ada) → biarkan ikon grid.
  if (frameCount > 0) {
    const thumb = document.createElement("img");
    thumb.className = "session-thumb";
    thumb.alt = "";
    thumb.decoding = "async";
    // Pakai opacity (bukan hidden) supaya <img> langsung trigger load
    // dan tidak dianggap "below fold" oleh lazy-load heuristic.
    thumb.style.opacity = "0";
    thumb.src = `/api/sessions/${session.id}/thumbnail?v=${encodeURIComponent(session.updatedAt || "")}`;
    thumb.addEventListener("load", () => {
      if (thumb.naturalWidth > 0 && thumb.naturalHeight > 0) {
        thumb.style.opacity = "1";
        previewIcon.remove();
      } else {
        thumb.remove();
      }
    });
    thumb.addEventListener("error", () => thumb.remove());
    preview.append(thumb);
  }
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
  return card;
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
    // Bila anon mencapai batas project, arahkan ke login.
    if (!state.user) showAuthView("login");
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
      if (item.modelsUsed?.length) appendTurnModels(turn, item.modelsUsed);
      else if (item.model) appendTurnModels(turn, [{ model: item.model, mode: item.aiMode }]);
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
  } else if ($(".turn-model-info", turn.body)) {
    turn.body.insertBefore(block, $(".turn-model-info", turn.body));
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
  const modelInfo = $(".turn-model-info", turn.body);
  if (modelInfo) turn.body.insertBefore(group, modelInfo);
  else turn.body.append(group);
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

function renderThinkingDotsHtml() {
  return '<span class="thinking-dots"><span></span><span></span><span></span></span>';
}

function appendTurnModels(turn, models) {
  const sequence = (models || []).filter((item) => item?.model);
  if (!turn || !sequence.length) return;
  $(".turn-model-info", turn.body)?.remove();
  const info = document.createElement("div");
  info.className = "turn-model-info";
  info.textContent = sequence.map(({ model, mode }) => {
    const label = mode === "multimodal" ? t("multimodal") : t("primary");
    return `${model} · ${label}`;
  }).join(" → ");
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
        onTurnStart();
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
        // Show "processing X of N" when multiple tools run in one turn.
        const pos = eventData.position && eventData.total
          ? `${eventData.position}/${eventData.total}`
          : null;
        setWorkspaceStatus("working", toolLabel(eventData.name) + (pos ? ` (${pos})` : ""));
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
      } else if (eventData.type === "frame_working") {
        // edit_file: signal that AI is working on this frame (drafting overlay).
        // Emitted while the model generates edit_file args, so the overlay shows
        // up early — unlike tool_args which fires only after the args are complete.
        if (eventData.path) onDraftUpdate(eventData.path);
      } else if (eventData.type === "frame_working_clear") {
        // edit_file done: clear overlay + reload the frame to pick up the edit.
        if (eventData.path) onDraftClear(eventData.path);
      } else if (eventData.type === "iteration_end") {
        finalizeAssistantTurn();
      } else if (eventData.type === "assistant_end") {
        finalizeAssistantTurn();
      } else if (eventData.type === "context_optimized") {
        notify(t("contextOptimized", { size: formatBytes(eventData.bytesSaved) }));
      } else if (eventData.type === "usage") {
        state.session.usage = eventData.usage;
        renderUsage(eventData.usage);
      } else if (eventData.type === "iteration_model") {
        flushBufferedContent();
        appendTurnModels(ensureAssistantTurn(), [{ model: eventData.model, mode: eventData.mode }]);
      } else if (eventData.type === "turn_model") {
        flushBufferedContent();
        appendTurnModels(ensureAssistantTurn(), eventData.models || []);
      } else if (eventData.type === "preview") {
        schedulePreview();
        onPreviewUpdate(eventData.path);
      } else if (eventData.type === "preview_draft") {
        scheduleDraftPreview();
        onDraftUpdate(eventData.path);
        setWorkspaceStatus("working", "statusLiveDraft");
      } else if (eventData.type === "preview_draft_clear") {
        schedulePreview();
        onDraftClear(eventData.path);
      } else if (eventData.type === "frame_created") {
        onFrameCreated(eventData.frame);
      } else if (eventData.type === "frame_deleted") {
        onFrameDeleted(eventData.frameId);
      } else if (eventData.type === "done") {
        flushBufferedContent();
        if (!sawAssistantOutput && eventData.message) {
          const turn = createAssistantTurn(false);
          appendTextBlock(turn, eventData.message);
          finalizeAssistantTurn(turn);
        }
        onTurnDone();
      } else if (eventData.type === "error") {
        throw new Error(eventData.message);
      }
    });
    flushBufferedContent();
    finalizeAssistantTurn();
    setWorkspaceStatus("ready", "statusReady");
    state.session.checkpointCount = (state.session.checkpointCount || 0) + 1;
    ui.undoButton.disabled = false;
    syncUndoState(state.session.checkpointCount);
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

async function stopAgent() {
  if (!state.session) return;
  try { await api(`/api/sessions/${state.session.id}/stop`, { method: "POST" }); }
  catch (error) { notify(error.message, true); }
}

function schedulePreview() {
  // When the canvas is active, frames manage their own reloads (via
  // onPreviewUpdate/onDraftUpdate). The workspace preview iframe only shows
  // index.html, so reloading it here for a draft of another file spams 404s.
  if (canvasView.isActive()) return;
  clearTimeout(state.previewTimer);
  clearTimeout(state.draftPreviewTimer);
  state.draftPreviewTimer = null;
  state.previewTimer = setTimeout(() => refreshPreview(), 350);
}

function scheduleDraftPreview() {
  if (canvasView.isActive()) return;
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
  if (canvasView.isActive()) return;
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
  const device = button.dataset.viewport;
  $$('[data-viewport]').forEach((item) => item.classList.toggle("active", item === button));
  ui.deviceFrame.className = `device-frame ${device}`;
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    applyUser(null);
    showAuthView("login");
    throw new Error(t("loginRequired"));
  }
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
function toolLabel(name) { return ({ list_dir: t("toolListDir"), read_file: t("toolReadFile"), write_file: t("toolWriteFile"), edit_file: t("toolEditFile"), copy_file: t("toolCopyFile"), capture_webpage_screenshot: t("toolCaptureWebpage"), create_frame: t("toolCreateFrame") })[name] || name; }
function formatDate(value) { return new Intl.DateTimeFormat(state.language === "id" ? "id-ID" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
