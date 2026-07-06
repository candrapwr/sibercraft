// Canvas view controller: orchestrates the full-screen canvas workspace.
// - Mounts (moves) the shared .chat-panel into the canvas chat-dock on enter,
//   restores it to the workspace view on leave — no duplicated state.
// - Initializes frames from session.frames, listens for `frame_created` events
//   from the chat stream, and persists frame position changes to the server.

import { canvas } from "/canvas.js";

const $ = (sel, root = document) => root.querySelector(sel);

let viewEl = null;
let layoutEl = null;
let dockEl = null;
let dockToggleEl = null;
let areaEl = null;
let viewportEl = null;
let emptyHintEl = null;
let zoomLabels = [];

// Where the chat-panel originally lives (so we can put it back on leave).
let chatHome = null;
let chatPanel = null;
let chatResizeHandle = null;
let dockOpen = true;

let session = null;
let inCanvas = false;

export const canvasView = {
  init,
  enter,
  leave,
  bootstrapFromFiles,
  isActive: () => inCanvas,
};

function init() {
  viewEl = $("#canvasView");
  layoutEl = $("#canvasLayout");
  dockEl = $("#chatDock");
  dockToggleEl = $("#chatDockToggle");
  areaEl = $("#canvasArea");
  viewportEl = $("#canvasViewport");
  emptyHintEl = $("#canvasEmptyHint");
  zoomLabels = [$("#cvZoomLabel"), $("#cvCtrlZoomLabel")];

  canvas.init({ area: areaEl, viewport: viewportEl, zoomLabels, emptyHint: emptyHintEl });
  canvas.setOnFramePersist(persistFrame);

  // Zoom controls (header + floating).
  $("#cvZoomIn")?.addEventListener("click", () => canvas._internal.zoomBy(1.2));
  $("#cvZoomOut")?.addEventListener("click", () => canvas._internal.zoomBy(1 / 1.2));
  $("#cvZoomFit")?.addEventListener("click", () => canvas._internal.fitAll());
  $("#cvCtrlZoomIn")?.addEventListener("click", () => canvas._internal.zoomBy(1.2));
  $("#cvCtrlZoomOut")?.addEventListener("click", () => canvas._internal.zoomBy(1 / 1.2));
  $("#cvCtrlZoomFit")?.addEventListener("click", () => canvas._internal.fitAll());

  dockToggleEl?.addEventListener("click", toggleDock);
  $("#cvUndoButton")?.addEventListener("click", undoFromCanvas);
  $("#cvBackButton")?.addEventListener("click", leave);
  $("#cvExportAllButton")?.addEventListener("click", exportAll);
  $("#cvThumbButton")?.addEventListener("click", regenerateThumbnail);

  // Export hooks used by canvas.js HUD.
  window.__sibercraftExportFrame = exportFrame;
  window.__sibercraftExportFrameHtml = exportFrameHtml;
  // Confirm dialog hook for closing a frame (#3).
  window.__sibercraftConfirmCloseFrame = confirmCloseFrame;
}

async function enter({ session: s, chatMount, chatResizeHandle: handle }) {
  if (inCanvas) return;
  session = s;
  inCanvas = true;

  // Move the shared chat-panel into the dock (and its resize handle, hidden in canvas).
  if (chatMount) {
    chatPanel = chatMount;
    chatHome = chatMount.parentElement;
    chatResizeHandle = handle;
    dockEl.appendChild(chatMount);
    if (chatResizeHandle) chatResizeHandle.style.display = "none";
  }

  // Hide workspace view, show canvas view.
  $("#workspaceView").hidden = true;
  viewEl.hidden = false;
  $("#cvTitle").textContent = s.name || "Canvas";

  // Initialize canvas engine + load existing frames.
  canvas.reset(s.id);
  const list = Array.isArray(s.frames) ? s.frames : [];
  // Some legacy/unsaved frames may still have x=0,y=0 (never dragged) and would
  // stack on top of each other. Re-assign a layout slot to any unplaced frame.
  for (const f of list) {
    const unplaced = !f.x && !f.y;
    if (unplaced) {
      const pos = canvas._internal.nextLayoutPosition(f.device);
      canvas.addFrame({ ...f, x: pos.x, y: pos.y });
    } else {
      canvas.addFrame(f);
    }
  }
  canvas._internal.bind();
  canvas._internal.loadFrameSrcs();

  // Fit existing frames into view, or show empty hint.
  if (list.length) {
    requestAnimationFrame(() => canvas._internal.fitAll());
  }
  updateEmptyHint();
  syncUndoState(s.checkpointCount);

  // Persist newly-assigned layout positions for previously-unplaced frames
  // so the next reload keeps them in place (best-effort; ignored for read-only).
  for (const f of list) {
    if (!f.x && !f.y) {
      const placed = canvas.getFrames().find((x) => x.id === f.id);
      if (placed) persistFrame({ action: "update", id: f.id, x: placed.x, y: placed.y, device: placed.device });
    }
  }

  dockOpen = true;
  layoutEl.classList.remove("dock-collapsed");
}

function leave() {
  if (!inCanvas) return;
  canvas._internal.unbind();
  canvas.reset(session?.id);

  // Clear any pending draft-reload timers so they don't fire after teardown.
  for (const t of draftTimers.values()) clearTimeout(t);
  draftTimers.clear();
  draftLastAt.clear();
  if (fitTimer) { clearTimeout(fitTimer); fitTimer = null; }
  activeDraftPath = null;

  // Restore chat-panel to its original home.
  if (chatPanel && chatHome) {
    chatHome.appendChild(chatPanel);
    if (chatResizeHandle) chatResizeHandle.style.display = "";
  }

  viewEl.hidden = true;
  // Kembali ke daftar project (bukan workspace view lama yang sudah tidak dipakai).
  const sessionsView = document.getElementById("sessionsView");
  const workspaceView = document.getElementById("workspaceView");
  if (sessionsView) sessionsView.hidden = false;
  if (workspaceView) workspaceView.hidden = true;
  inCanvas = false;
  session = null;
  // Beri tahu app.js supaya state.session di-clear dan UI di-reset.
  window.dispatchEvent(new CustomEvent("sibercraft:canvas-left"));
}

/**
 * Bootstrap canvas frames from workspace files (ephemeral, client-side only).
 * Used when a session has no frames field yet (legacy) — especially for
 * read-only/public projects where we can't persist migration server-side.
 * Scans /files, picks every .html, and creates a frame per file.
 */
async function bootstrapFromFiles(sessionId) {
  if (!inCanvas || !sessionId) return;
  if (canvas.getFrames().length > 0) return; // already has frames
  try {
    const res = await fetch(`/api/sessions/${sessionId}/files`);
    if (!res.ok) return;
    const files = await res.json();
    const htmlFiles = (files || []).filter((f) => /\.html?$/i.test(f.path));
    if (!htmlFiles.length) return;
    for (const file of htmlFiles) {
      // ephemeral frame (ephemeral id so it won't collide with server frame ids)
      canvas.addFrame({
        id: `eph-${file.path}-${Date.now()}`,
        file: file.path,
        device: "desktop",
        x: 0,
        y: 0,
      });
    }
    canvas._internal.loadFrameSrcs();
    requestAnimationFrame(() => canvas._internal.fitAll());
    updateEmptyHint();
  } catch (e) {
    // ignore — canvas stays empty, user can chat to create frames.
  }
}

function toggleDock() {
  dockOpen = !dockOpen;
  layoutEl.classList.toggle("dock-collapsed", !dockOpen);
  dockToggleEl.textContent = dockOpen ? "‹" : "›";
  dockToggleEl.title = dockOpen ? "Collapse chat" : "Expand chat";
}

function updateEmptyHint() {
  if (emptyHintEl) emptyHintEl.hidden = canvas.getFrames().length > 0;
}

/** Called by the chat stream dispatcher when a `frame_created` event arrives. */
export function onFrameCreated(frame) {
  if (!inCanvas) return;
  // Server always sends x/y (default 0 for new frames). Treat 0/undefined as
  // "not yet placed" so the next layout slot is used instead of stacking at 0,0.
  const placed = typeof frame.x === "number" && frame.x !== 0;
  const pos = placed ? { x: frame.x, y: frame.y } : canvas._internal.nextLayoutPosition(frame.device);
  const full = canvas.addFrame({ ...frame, x: pos.x, y: pos.y });
  // Load the iframe src for the new frame, then fit all frames into view.
  setTimeout(() => {
    canvas.reloadFrame(frame.id);
    canvas._internal.fitAll();
    updateEmptyHint();
  }, 0);
  persistFrame({ action: "update", id: frame.id, x: full.x, y: full.y, device: full.device });
}

/** Called by the chat stream dispatcher when a `frame_deleted` event arrives. */
export function onFrameDeleted(frameId) {
  if (!inCanvas || !frameId) return;
  canvas.removeFrame(frameId);
  canvas._internal.zoomToFit();
  updateEmptyHint();
}

/** Called when AI writes a file — reload matching frames. */
export function onPreviewUpdate(path) {
  if (!inCanvas) return;
  if (path) {
    const matches = canvas.getFrames().filter((f) => f.file === path);
    // Reload frames whose file matches.
    matches.forEach((f) => canvas.reloadFrame(f.id));
    // edit_file (and other direct writes) only emit `preview`, never `preview_draft`.
    // So the auto-zoom that normally follows drafts wouldn't fire. Trigger it here:
    // if this file wasn't already being streamed as a draft, zoom into it now.
    if (matches.length && activeDraftPath !== path) {
      activeDraftPath = path;
      canvas._internal.zoomToFrame(matches[0].id);
    }
  }
}

const draftTimers = new Map(); // file -> setTimeout handle (per-frame throttle)
const draftLastAt = new Map(); // file -> timestamp
const DRAFT_INTERVAL = 200;    // min ms between draft reloads per frame
let activeDraftPath = null;    // file currently being streamed; zoom follows it
let fitTimer = null;           // pending zoomToFit (cancelled if a new turn starts)

/**
 * Called on `preview_draft` — server is streaming new content for `path`.
 * Reload the matching frame's iframe (throttled per-file) so the user sees
 * the live draft update. iframe stays fully interactive between reloads.
 * Auto-zoom into the frame being edited; when AI switches to a different
 * file (e.g. editing 2 frames in one turn), the focus follows it.
 */
export function onDraftUpdate(path) {
  if (!inCanvas || !path) return;
  const matches = canvas.getFrames().filter((f) => f.file === path);
  if (!matches.length) return;
  canvas.setDrafting(path, true);
  // Focus follows the file currently being drafted. When the AI moves on to
  // a different file, zoom into that frame instead. Debounced so rapid
  // back-to-back drafts of the same file don't re-trigger the animation.
  if (activeDraftPath !== path) {
    activeDraftPath = path;
    canvas._internal.zoomToFrame(matches[0].id);
  }
  const now = Date.now();
  const last = draftLastAt.get(path) || 0;
  const elapsed = now - last;
  if (elapsed >= DRAFT_INTERVAL) {
    draftLastAt.set(path, now);
    matches.forEach((f) => canvas.reloadFrame(f.id));
    return;
  }
  // Schedule a trailing reload for the remainder, only one pending per file.
  if (draftTimers.has(path)) return;
  draftTimers.set(
    path,
    setTimeout(() => {
      draftTimers.delete(path);
      draftLastAt.set(path, Date.now());
      canvas.getFrames().filter((f) => f.file === path).forEach((f) => canvas.reloadFrame(f.id));
    }, DRAFT_INTERVAL - elapsed)
  );
}

/** Called on `preview_draft_clear` — draft removed, final file being written. */
export function onDraftClear(path) {
  if (!path) return;
  const t = draftTimers.get(path);
  if (t) { clearTimeout(t); draftTimers.delete(path); }
  draftLastAt.delete(path);
  if (!inCanvas) return;
  canvas.setDrafting(path, false);
  // Reload once to pick up the finalized file on disk.
  canvas.getFrames().filter((f) => f.file === path).forEach((f) => canvas.reloadFrame(f.id));
}

/** Called when a new AI turn starts — reset focus tracking & cancel pending fit. */
export function onTurnStart() {
  activeDraftPath = null;
  if (fitTimer) { clearTimeout(fitTimer); fitTimer = null; }
}

/** Called when the AI turn ends — animate back to fit-all so everything is visible. */
export function onTurnDone() {
  if (!inCanvas) return;
  activeDraftPath = null;
  // Small delay so the final preview reload settles first.
  fitTimer = setTimeout(() => {
    fitTimer = null;
    if (inCanvas) canvas._internal.zoomToFit();
  }, 250);
}

async function persistFrame({ action, id, x, y, device }) {
  if (!session) return;
  const base = `/api/sessions/${session.id}/frame/${id}`;
  try {
    if (action === "remove") {
      await fetch(base, { method: "DELETE" });
    } else {
      const body = {};
      if (typeof x === "number") body.x = x;
      if (typeof y === "number") body.y = y;
      if (device) body.device = device;
      await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
  } catch (e) {
    // Persist failures are non-fatal; position stays local.
    console.warn("frame persist failed", e);
  }
}

async function exportFrame(state) {
  if (!session) return;
  const width = Math.max(390, state.w || 1280);
  try {
    const res = await fetch(
      `/api/sessions/${session.id}/export/image?width=${width}&file=${encodeURIComponent(state.file)}`
    );
    if (!res.ok) throw new Error("Export gagal");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(state.file || "preview").replace(/\.html?$/i, "")}.png`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message);
  }
}

/** Export single-file HTML (inlined) for a frame's pinned file — #2. */
async function exportFrameHtml(state) {
  if (!session) return;
  try {
    const res = await fetch(
      `/api/sessions/${session.id}/export/html?file=${encodeURIComponent(state.file)}`
    );
    if (!res.ok) throw new Error("Export HTML gagal");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(state.file || "preview").replace(/\.html?$/i, "")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message);
  }
}

/** Export the ENTIRE workspace (all files + per-frame screenshots) as a ZIP. */
async function exportAll() {
  if (!session) return;
  const btn = document.getElementById("cvExportAllButton");
  let origText = null;
  if (btn) { origText = btn.textContent; btn.disabled = true; btn.textContent = "⏳ Exporting…"; }
  try {
    const res = await fetch(`/api/sessions/${session.id}/export/zip-all`);
    if (!res.ok) throw new Error("Export All gagal");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${session.name || "project"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(e.message);
  } finally {
    if (btn && origText != null) { btn.disabled = false; btn.textContent = origText; }
  }
}

/** Regenerate thumbnail for the current session — manual trigger. */
async function regenerateThumbnail() {
  if (!session) return;
  const btn = document.getElementById("cvThumbButton");
  let origText = null;
  if (btn) { origText = btn.textContent; btn.disabled = true; btn.textContent = "⏳ Generating…"; }
  try {
    const res = await fetch(`/api/sessions/${session.id}/regenerate-thumbnail`, { method: "POST" });
    if (!res.ok) throw new Error("Regenerate thumbnail gagal");
  } catch (e) {
    alert(e.message || "Gagal memperbarui thumbnail");
  } finally {
    if (btn && origText != null) { btn.disabled = false; btn.textContent = origText; }
  }
}

/** Confirm dialog before removing a frame — #3. Uses native confirm for MVP. */
function confirmCloseFrame(state, onConfirm) {
  const name = (state.file || "").replace(/\.html?$/i, "") || "frame";
  if (confirm(`Hapus frame "${name}"? File di workspace tetap ada, hanya frame yang dihapus dari canvas.`)) {
    onConfirm();
  }
}

/** Undo last change from canvas view — #5. Reloads frames + previews after. */
async function undoFromCanvas() {
  if (!session) return;
  const btn = document.getElementById("cvUndoButton");
  if (btn) btn.disabled = true;
  try {
    await fetch(`/api/sessions/${session.id}/undo`, { method: "POST" });
    // Reload session to get latest frames + checkpointCount.
    const res = await fetch(`/api/sessions/${session.id}`);
    const updated = await res.json();
    session = updated;
    // Rebuild canvas frames from fresh session data.
    canvas.reset(session.id);
    for (const f of updated.frames || []) canvas.addFrame(f);
    canvas._internal.loadFrameSrcs();
    requestAnimationFrame(() => canvas._internal.fitAll());
  } catch (e) {
    alert(e.message || "Undo gagal");
  } finally {
    if (btn) btn.disabled = !(session && session.checkpointCount);
  }
}

/** Update the undo button's disabled state from outside (after chat turns). */
export function syncUndoState(checkpointCount) {
  const btn = document.getElementById("cvUndoButton");
  if (btn) btn.disabled = !checkpointCount;
}
