// Canvas engine: infinite pannable/zoomable canvas hosting multiple preview frames.
// Concept ported from siberboard (viewport.js + drag.js), generalized to many frames.
//
// Layout invariant:
//   #canvasArea (stage — receives pointer/wheel, never transformed)
//     └─ #canvasViewport (the ONLY element that gets translate+scale)
//          └─ .canvas-frame (absolute, world-coord left/top/width/height) × N
//               ├─ .frame-label (counter-scaled title)
//               ├─ .frame-hud (counter-scaled toolbar)
//               ├─ .frame-drag-handle (border band for dragging the frame)
//               └─ iframe (preview of the pinned HTML file)

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const DEFAULT_ZOOM = 0.7; // 70% — default zoom when entering canvas / resetting view

// Device sizes in world units. Keep in sync with backend DEVICE_SIZES.
const DEVICE_SIZE = {
  desktop: { w: 1280, h: 800 },
  tablet: { w: 768, h: 1024 },
  mobile: { w: 390, h: 844 },
};

const view = { panX: 0, panY: 0, zoom: DEFAULT_ZOOM };

let areaEl = null;
let viewportEl = null;
let zoomLabelEls = [];
let emptyHintEl = null;
let sessionId = null;
let active = false;

// Frame registry: id -> { el, state:{id,file,device,x,y,w,h}, dirty }
const frames = new Map();
let selectedId = null;

// Persistence callback (debounced). Set by canvas-view controller.
let onFramePersist = null;

// Animation state for smooth zoom transitions (auto-focus on edited frame).
let animFrame = null;        // requestAnimationFrame handle
let animFrom = null;          // { panX, panY, zoom } start
let animTo = null;            // { panX, panY, zoom } end
let animStart = 0;            // timestamp
const ANIM_MS = 420;          // duration
const ANIM_EASE = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic

// Interaction state machine.
let mode = null; // 'pan' | 'frame' | null
let startClientX = 0;
let startClientY = 0;
let startPanX = 0;
let startPanY = 0;
let dragFrameId = null;
let dragStartX = 0;
let dragStartY = 0;
let persistTimer = null;

export const canvas = {
  init,
  reset,
  addFrame,
  removeFrame,
  updateFrame,
  getFrames: () => [...frames.values()].map((f) => f.state),
  reloadFrame,
  setDrafting,
  fitAll,
  setOnFramePersist(fn) { onFramePersist = fn; },
};

function init({ area, viewport, zoomLabels = [], emptyHint }) {
  areaEl = area;
  viewportEl = viewport;
  zoomLabelEls = zoomLabels.filter(Boolean);
  emptyHintEl = emptyHint;
}

function reset(id) {
  sessionId = id;
  for (const frame of frames.values()) frame.el.remove();
  frames.clear();
  selectedId = null;
  view.panX = 0;
  view.panY = 0;
  view.zoom = DEFAULT_ZOOM;
}

function deviceSize(device) {
  return DEVICE_SIZE[device] || DEVICE_SIZE.desktop;
}

/** Create a DOM element for a frame and register it. */
function addFrame(state) {
  if (!viewportEl) return;
  if (frames.has(state.id)) {
    updateFrame(state.id, state);
    return frames.get(state.id).state;
  }
  const size = deviceSize(state.device);
  const fullState = {
    id: state.id,
    file: state.file,
    device: state.device || "desktop",
    x: state.x ?? 0,
    y: state.y ?? 0,
    w: state.w ?? size.w,
    h: state.h ?? size.h,
  };
  const el = buildFrameEl(fullState);
  viewportEl.appendChild(el);
  frames.set(state.id, { el, state: fullState, dirty: false });
  if (emptyHintEl) emptyHintEl.hidden = frames.size > 0;
  return fullState;
}

function buildFrameEl(state) {
  const el = document.createElement("div");
  el.className = `canvas-frame ${state.device || "desktop"}`;
  el.dataset.frameId = state.id;
  el.dataset.file = state.file;
  el.innerHTML = `
    <div class="frame-drag-handle top" aria-hidden="true"></div>
    <div class="frame-drag-handle bottom" aria-hidden="true"></div>
    <div class="frame-drag-handle left" aria-hidden="true"></div>
    <div class="frame-drag-handle right" aria-hidden="true"></div>
    <div class="frame-drag-handle corner tl" aria-hidden="true"></div>
    <div class="frame-drag-handle corner tr" aria-hidden="true"></div>
    <div class="frame-drag-handle corner bl" aria-hidden="true"></div>
    <div class="frame-drag-handle corner br" aria-hidden="true"></div>
    <div class="frame-label"></div>
    <div class="frame-devices">
      <button type="button" data-device="desktop" data-tip="Desktop" data-tip-pos="left" aria-label="Desktop">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="11" rx="1.75"></rect><path d="M9 19h6"></path><path d="M12 16v3"></path></svg>
      </button>
      <button type="button" data-device="tablet" data-tip="Tablet" data-tip-pos="left" aria-label="Tablet">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3.5" width="10" height="17" rx="2"></rect><path d="M11 17.5h2"></path></svg>
      </button>
      <button type="button" data-device="mobile" data-tip="Mobile" data-tip-pos="left" aria-label="Mobile">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.25" y="2.75" width="7.5" height="18.5" rx="2"></rect><path d="M11 5h2"></path><circle cx="12" cy="18" r=".8" fill="currentColor" stroke="none"></circle></svg>
      </button>
    </div>
    <div class="frame-hud">
      <div class="hud-group hud-actions">
        <button type="button" data-act="refresh" data-tip="Refresh" data-tip-pos="bottom" aria-label="Refresh preview">↻</button>
        <button type="button" data-act="open" data-tip="Open in new tab" data-tip-pos="bottom" aria-label="Open in new tab">↗</button>
        <button type="button" data-act="export" data-tip="Export image" data-tip-pos="bottom" aria-label="Export image">🖼</button>
        <button type="button" data-act="export-html" data-tip="Export HTML" data-tip-pos="bottom" aria-label="Export HTML">⇩</button>
        <button type="button" data-act="close" data-tip="Close frame" data-tip-pos="bottom" aria-label="Close frame">×</button>
      </div>
    </div>
    <iframe title="Preview" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"></iframe>
  `;
  applyFrameBox(el, state);
  // Wire HUD buttons (delegation handled at area level; here we set initial device active state).
  syncDeviceButtons(el, state.device);
  return el;
}

function applyFrameBox(el, state) {
  el.style.left = state.x + "px";
  el.style.top = state.y + "px";
  el.style.width = state.w + "px";
  el.style.height = state.h + "px";
  const labelEl = el.querySelector(".frame-label");
  if (labelEl) labelEl.textContent = frameTitle(state.file);
}

function syncDeviceButtons(el, device) {
  el.querySelectorAll("[data-device]").forEach((b) =>
    b.classList.toggle("active", b.dataset.device === device)
  );
}

function frameTitle(file) {
  return String(file || "").replace(/\.html?$/i, "").replace(/[/_-]+/g, " ").trim() || "preview";
}

function updateFrame(id, patch) {
  const frame = frames.get(id);
  if (!frame) return;
  Object.assign(frame.state, patch);
  if (patch.device) {
    const size = deviceSize(patch.device);
    frame.state.w = size.w;
    frame.state.h = size.h;
    frame.el.classList.remove("desktop", "tablet", "mobile");
    frame.el.classList.add(patch.device);
    syncDeviceButtons(frame.el, patch.device);
  }
  applyFrameBox(frame.el, frame.state);
  return frame.state;
}

function removeFrame(id) {
  const frame = frames.get(id);
  if (!frame) return;
  frame.el.remove();
  frames.delete(id);
  if (selectedId === id) selectedId = null;
  if (emptyHintEl) emptyHintEl.hidden = frames.size > 0;
}

function reloadFrame(id) {
  const frame = frames.get(id);
  if (!frame) return;
  const iframe = frame.el.querySelector("iframe");
  if (iframe) {
    const url = framePreviewUrl(frame.state.file);
    if (url) iframe.src = url;
  }
}

/** Toggle a "drafting" visual state on frames previewing `file` (live stream indicator). */
function setDrafting(file, on) {
  for (const frame of frames.values()) {
    if (frame.state.file === file) frame.el.classList.toggle("drafting", on);
  }
}

function reloadAll(file) {
  // Reload frames matching a file path (after AI writes to it).
  for (const frame of frames.values()) {
    if (!file || frame.state.file === file) {
      const iframe = frame.el.querySelector("iframe");
      if (iframe) iframe.src = framePreviewUrl(frame.state.file);
    }
  }
}

function framePreviewUrl(file) {
  if (!sessionId || !file) return null;
  return `/preview/${sessionId}/${encodeURIComponent(file)}?v=${Date.now()}`;
}

function loadFrameSrcs() {
  for (const frame of frames.values()) {
    const iframe = frame.el.querySelector("iframe");
    if (iframe) iframe.src = framePreviewUrl(frame.state.file);
  }
}

// --- transform / coordinate math ---

function applyTransform() {
  if (!viewportEl) return;
  viewportEl.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  const hudScale = 1 / view.zoom;
  // Counter-scale every frame's HUD + label so they stay crisp/readable.
  for (const frame of frames.values()) {
    frame.el.style.setProperty("--hud-scale", hudScale);
  }
  const gap = 16 * view.zoom;
  areaEl.style.backgroundSize = `${gap}px ${gap}px`;
  areaEl.style.backgroundPosition = `${view.panX}px ${view.panY}px`;
  for (const label of zoomLabelEls) label.textContent = Math.round(view.zoom * 100) + "%";
}

function clampZoom(z) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

function zoomAround(px, py, nextZoom) {
  const z = clampZoom(nextZoom);
  if (z === view.zoom) return;
  const wx = (px - view.panX) / view.zoom;
  const wy = (py - view.panY) / view.zoom;
  view.panX = px - wx * z;
  view.panY = py - wy * z;
  view.zoom = z;
  applyTransform();
}

function zoomBy(factor) {
  cancelAnim();
  const r = areaEl.getBoundingClientRect();
  zoomAround(r.width / 2, r.height / 2, view.zoom * factor);
}

/** Compute bounding box of all frames and fit them into view, centered. */
function fitAll() {
  cancelAnim();
  if (!areaEl || frames.size === 0) {
    resetView();
    return;
  }
  const r = areaEl.getBoundingClientRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const frame of frames.values()) {
    const s = frame.state;
    minX = Math.min(minX, s.x);
    minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w);
    maxY = Math.max(maxY, s.y + s.h);
  }
  const fw = Math.max(1, maxX - minX);
  const fh = Math.max(1, maxY - minY);
  const pad = 40;
  const zx = (r.width - pad * 2) / fw;
  const zy = (r.height - pad * 2) / fh;
  const z = clampZoom(Math.min(zx, zy, MAX_ZOOM));
  view.zoom = z;
  view.panX = (r.width - fw * z) / 2 - minX * z;
  view.panY = (r.height - fh * z) / 2 - minY * z;
  applyTransform();
}

function resetView() {
  view.panX = 0;
  view.panY = 0;
  view.zoom = DEFAULT_ZOOM;
  applyTransform();
}

/** Smoothly animate view from current state to target {panX,panY,zoom}. */
function animateTo(target) {
  cancelAnim();
  animFrom = { panX: view.panX, panY: view.panY, zoom: view.zoom };
  animTo = target;
  animStart = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - animStart) / ANIM_MS);
    const e = ANIM_EASE(t);
    view.panX = animFrom.panX + (animTo.panX - animFrom.panX) * e;
    view.panY = animFrom.panY + (animTo.panY - animFrom.panY) * e;
    view.zoom = animFrom.zoom + (animTo.zoom - animFrom.zoom) * e;
    applyTransform();
    if (t < 1) animFrame = requestAnimationFrame(step);
    else { animFrame = null; animFrom = animTo = null; }
  };
  animFrame = requestAnimationFrame(step);
}

function cancelAnim() {
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  animFrom = animTo = null;
}

/**
 * Animate zoom to focus a single frame (center it, fill ~70% of view).
 * Called when AI starts editing a frame so the user watches it being built.
 */
function zoomToFrame(id) {
  const frame = frames.get(id);
  if (!frame || !areaEl) return;
  const r = areaEl.getBoundingClientRect();
  const s = frame.state;
  // Zoom in close: fit the frame to ~90% of the viewport so it reads clearly
  // while editing. Small padding only for the HUD/label around the edges.
  const pad = 60;
  const zx = (r.width - pad * 2) / s.w;
  const zy = (r.height - pad * 2) / s.h;
  const z = clampZoom(Math.min(zx, zy, MAX_ZOOM));
  // Center the frame in the viewport.
  const panX = (r.width - s.w * z) / 2 - s.x * z;
  const panY = (r.height - s.h * z) / 2 - s.y * z;
  animateTo({ panX, panY, zoom: z });
  selectFrame(id);
}

/** Animate back to fit-all (used when AI finishes editing). */
function zoomToFit() {
  if (frames.size === 0) { animateTo({ panX: 0, panY: 0, zoom: DEFAULT_ZOOM }); return; }
  // Compute fitAll target without applying yet, then animate to it.
  const r = areaEl.getBoundingClientRect();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const frame of frames.values()) {
    const s = frame.state;
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
  }
  const fw = Math.max(1, maxX - minX), fh = Math.max(1, maxY - minY);
  const pad = 40;
  const z = clampZoom(Math.min((r.width - pad * 2) / fw, (r.height - pad * 2) / fh, MAX_ZOOM));
  animateTo({ panX: (r.width - fw * z) / 2 - minX * z, panY: (r.height - fh * z) / 2 - minY * z, zoom: z });
}

// --- auto-layout for new frames ---
// Place frames in a row; wrap to next row every LAYOUT_COL frames.
const LAYOUT_COL = 3;
const LAYOUT_GAP = 80;
function nextLayoutPosition(device = "desktop") {
  const count = frames.size;
  const col = count % LAYOUT_COL;
  const row = Math.floor(count / LAYOUT_COL);
  // Use the new frame's own device size so the slot fits it (not always desktop).
  const size = DEVICE_SIZE[device] || DEVICE_SIZE.desktop;
  return {
    x: col * (size.w + LAYOUT_GAP),
    y: row * (size.h + LAYOUT_GAP),
  };
}

// --- pointer interaction ---

function bind() {
  if (active || !areaEl) return;
  active = true;
  areaEl.addEventListener("pointerdown", onPointerDown);
  areaEl.addEventListener("click", onAreaClick);
  areaEl.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function unbind() {
  if (!active) return;
  active = false;
  mode = null;
  areaEl?.removeEventListener("pointerdown", onPointerDown);
  areaEl?.removeEventListener("click", onAreaClick);
  areaEl?.removeEventListener("wheel", onWheel);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest(".ui-chrome")) return; // zoom controls
  if (e.target.closest(".frame-hud")) return; // HUD buttons handled on click
  if (e.target.closest(".frame-devices")) return; // device buttons handled on click
  cancelAnim(); // user interaction interrupts any running auto-focus animation

  const frameEl = e.target.closest(".canvas-frame");
  const onHandle = e.target.closest(".frame-drag-handle");

  if (onHandle && frameEl) {
    // Drag the frame by its edge strips (iframe in the middle stays interactive).
    dragFrameId = frameEl.dataset.frameId;
    const frame = frames.get(dragFrameId);
    if (!frame) return;
    mode = "frame";
    dragStartX = frame.state.x;
    dragStartY = frame.state.y;
    selectFrame(dragFrameId);
    frameEl.classList.add("grabbing");
    startClientX = e.clientX;
    startClientY = e.clientY;
    areaEl.setPointerCapture?.(e.pointerId);
  } else if (!frameEl) {
    // Pan when pressing on empty canvas.
    mode = "pan";
    startPanX = view.panX;
    startPanY = view.panY;
    areaEl.classList.add("grabbing");
    selectFrame(null);
    startClientX = e.clientX;
    startClientY = e.clientY;
    areaEl.setPointerCapture?.(e.pointerId);
  }
  // else: klik pada iframe / frame body → biarkan iframe menanganinya (interactive).
}

function onPointerMove(e) {
  if (!mode) return;
  if (mode === "frame" && dragFrameId) {
    const dx = (e.clientX - startClientX) / view.zoom;
    const dy = (e.clientY - startClientY) / view.zoom;
    updateFrame(dragFrameId, { x: dragStartX + dx, y: dragStartY + dy });
    schedulePersist(dragFrameId);
  } else if (mode === "pan") {
    view.panX = startPanX + (e.clientX - startClientX);
    view.panY = startPanY + (e.clientY - startClientY);
    applyTransform();
  }
}

function onPointerUp(e) {
  if (mode === "frame" && dragFrameId) {
    flushPersist(dragFrameId);
    const frame = frames.get(dragFrameId);
    frame?.el.classList.remove("grabbing");
  }
  mode = null;
  dragFrameId = null;
  areaEl?.classList.remove("grabbing");
  if (areaEl?.hasPointerCapture?.(e.pointerId)) areaEl.releasePointerCapture(e.pointerId);
}

/** Handle HUD button clicks (device, refresh, open, export, close) + frame selection. */
function onAreaClick(e) {
  const frameEl = e.target.closest(".canvas-frame");
  if (!frameEl) return;
  const id = frameEl.dataset.frameId;
  // Device buttons (left-top, vertical group).
  const deviceBtn = e.target.closest("[data-device]");
  if (deviceBtn) {
    updateFrame(id, { device: deviceBtn.dataset.device });
    schedulePersist(id);
    return;
  }
  // Action buttons (right-top HUD group).
  if (e.target.closest(".frame-hud")) {
    const actBtn = e.target.closest("[data-act]");
    if (actBtn) {
      const frame = frames.get(id);
      if (!frame) return;
      const act = actBtn.dataset.act;
      if (act === "refresh") reloadFrame(id);
      else if (act === "open") window.open(framePreviewUrl(frame.state.file), "_blank", "noopener");
      else if (act === "export") exportFrame(frame.state);
      else if (act === "export-html") exportFrameHtml(frame.state);
      else if (act === "close") closeFrameWithConfirm(id);
      return;
    }
    return;
  }
  if (frameEl) selectFrame(frameEl.dataset.frameId);
  else selectFrame(null);
}

function selectFrame(id) {
  if (selectedId === id) return;
  if (selectedId) frames.get(selectedId)?.el.classList.remove("selected");
  selectedId = id;
  if (id) frames.get(id)?.el.classList.add("selected");
}

function onWheel(e) {
  if (e.target.closest(".ui-chrome")) return;
  const overFrame = e.target.closest(".canvas-frame");
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const r = areaEl.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAround(e.clientX - r.left, e.clientY - r.top, view.zoom * factor);
  } else if (!overFrame) {
    e.preventDefault();
    view.panX -= e.deltaX;
    view.panY -= e.deltaY;
    applyTransform();
  }
  // else: plain wheel over a frame → let iframe scroll natively.
}

// --- persistence (debounced per-frame) ---

function schedulePersist(id) {
  const frame = frames.get(id);
  if (frame) frame.dirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    for (const [fid, frame] of frames.entries()) {
      if (frame.dirty) flushPersist(fid);
    }
  }, 500);
}

function flushPersist(id) {
  const frame = frames.get(id);
  if (!frame || !frame.dirty) return;
  frame.dirty = false;
  if (onFramePersist) {
    onFramePersist({
      action: "update",
      id,
      x: frame.state.x,
      y: frame.state.y,
      device: frame.state.device,
    });
  }
}

function exportFrame(state) {
  // Delegate to a global hook set by canvas-view (avoids circular import).
  if (window.__sibercraftExportFrame) window.__sibercraftExportFrame(state);
}

function exportFrameHtml(state) {
  if (window.__sibercraftExportFrameHtml) window.__sibercraftExportFrameHtml(state);
}

/** Hapus frame dengan konfirmasi (popup) dulu — #3. */
function closeFrameWithConfirm(id) {
  const frame = frames.get(id);
  if (!frame) return;
  if (window.__sibercraftConfirmCloseFrame) {
    window.__sibercraftConfirmCloseFrame(frame.state, () => {
      removeFrame(id);
      if (onFramePersist) onFramePersist({ action: "remove", id });
    });
  } else {
    removeFrame(id);
    if (onFramePersist) onFramePersist({ action: "remove", id });
  }
}

// Public helpers used by canvas-view controller.
canvas._internal = {
  bind,
  unbind,
  loadFrameSrcs,
  applyTransform,
  fitAll,
  resetView,
  zoomBy,
  zoomToFrame,
  zoomToFit,
  nextLayoutPosition,
};
