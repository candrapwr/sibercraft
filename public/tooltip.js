// Custom tooltip system (zero-dependency, vanilla JS).
//
// Replaces the slow, unstyled native `title` tooltip with a fast, styled one
// rendered at the <body> level. Rendering at body level avoids inheriting
// parent transforms — crucial for the canvas HUD buttons which are counter-
// scaled by --hud-scale; a tooltip inside that scaled subtree would render
// either tiny or huge depending on zoom.
//
// Usage on any element:
//   <button data-tip="Refresh">↻</button>
//   <button data-tip="Open" data-tip-pos="right">↗</button>
//
// Native `title` attributes are left intact for accessibility — we strip
// them at runtime on first hover to suppress the native tooltip and avoid
// the double-tooltip flicker. We re-restore on blur/leave.
//
// Positions supported via [data-tip-pos]: top (default), bottom, left, right.
// The tooltip auto-flips if it would overflow the viewport.

const SHOW_DELAY = 150;   // ms before showing (native browser is ~500ms)
const HIDE_DELAY = 60;    // ms before hiding — small grace to avoid flicker on adjacent buttons

let tipEl = null;
let showTimer = null;
let hideTimer = null;
let currentTarget = null;
let savedTitle = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  tipEl.className = "sc-tip";
  tipEl.setAttribute("role", "tooltip");
  tipEl.hidden = true;
  document.body.appendChild(tipEl);
  return tipEl;
}

function clearTimers() {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

function hide() {
  clearTimers();
  if (!tipEl) return;
  tipEl.hidden = true;
  tipEl.classList.remove("show");
  // Restore the suppressed native title so it remains accessible to AT / if JS
  // later detaches this module.
  if (currentTarget && savedTitle != null) {
    currentTarget.setAttribute("title", savedTitle);
    savedTitle = null;
  }
  currentTarget = null;
}

function position(target, pos) {
  const tip = ensureTip();
  const rect = target.getBoundingClientRect();
  // Make tip measurable (hidden but laid out). Use a temporary unhide.
  tip.style.left = "0px";
  tip.style.top = "0px";
  tip.hidden = false;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let primary = pos || "top";
  // Auto-flip if overflow.
  const overflowTop = rect.top - th - margin < 0;
  const overflowBottom = rect.bottom + th + margin > vh;
  const overflowLeft = rect.left - tw - margin < 0;
  const overflowRight = rect.right + tw + margin > vw;
  if (primary === "top" && overflowTop && !overflowBottom) primary = "bottom";
  else if (primary === "bottom" && overflowBottom && !overflowTop) primary = "top";
  else if (primary === "left" && overflowLeft && !overflowRight) primary = "right";
  else if (primary === "right" && overflowRight && !overflowLeft) primary = "left";
  // Fallback: if still overflowing on the chosen axis, nudge inside viewport.

  let x = 0;
  let y = 0;
  if (primary === "top") {
    x = rect.left + rect.width / 2 - tw / 2;
    y = rect.top - th - margin;
  } else if (primary === "bottom") {
    x = rect.left + rect.width / 2 - tw / 2;
    y = rect.bottom + margin;
  } else if (primary === "left") {
    x = rect.left - tw - margin;
    y = rect.top + rect.height / 2 - th / 2;
  } else {
    x = rect.right + margin;
    y = rect.top + rect.height / 2 - th / 2;
  }
  // Clamp into viewport (with a 6px gutter) — horizontal nudge is safe for
  // top/bottom tips; vertical nudge safe for left/right.
  const gutter = 6;
  x = Math.max(gutter, Math.min(x, vw - tw - gutter));
  y = Math.max(gutter, Math.min(y, vh - th - gutter));

  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
}

function showFor(target) {
  const text = target.dataset.tip;
  if (!text) return;
  const tip = ensureTip();
  tip.textContent = text;
  position(target, target.dataset.tipPos || "top");
  // Trigger fade-in transition.
  requestAnimationFrame(() => tip.classList.add("show"));
}

function scheduleShow(target) {
  clearTimers();
  currentTarget = target;
  // Suppress the native tooltip to avoid double rendering.
  if (target.hasAttribute("title")) {
    savedTitle = target.getAttribute("title");
    target.removeAttribute("title");
  }
  showTimer = setTimeout(() => showFor(target), SHOW_DELAY);
}

function scheduleHide() {
  clearTimers();
  hideTimer = setTimeout(hide, HIDE_DELAY);
}

function onEnter(event) {
  const target = event.target.closest("[data-tip]");
  if (!target || target === currentTarget) return;
  scheduleShow(target);
}

function onLeave(event) {
  const target = event.target.closest("[data-tip]");
  if (!target) return;
  // If moving to a related target that itself has data-tip, the new enter
  // handler will reschedule; otherwise hide.
  if (event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest("[data-tip]")) return;
  scheduleHide();
}

function onFocusIn(event) {
  const target = event.target.closest && event.target.closest("[data-tip]");
  if (target) {
    clearTimers();
    currentTarget = target;
    if (target.hasAttribute("title")) {
      savedTitle = target.getAttribute("title");
      target.removeAttribute("title");
    }
    showFor(target);
  }
}

function onFocusOut(event) {
  const target = event.target.closest && event.target.closest("[data-tip]");
  if (target) hide();
}

/** Initialize global tooltip listeners. Call once at app startup. */
export function initTooltips() {
  ensureTip();
  // Delegation: one pair of listeners for the whole document.
  document.addEventListener("mouseover", onEnter);
  document.addEventListener("mouseout", onLeave);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  // Hide on scroll/resize so it doesn't float stale next to its target.
  window.addEventListener("scroll", hide, { passive: true, capture: true });
  window.addEventListener("blur", hide);
}

/** Programmatically set/translate a tooltip on an element. */
export function setTip(el, text, pos) {
  if (!el) return;
  if (text) {
    el.dataset.tip = text;
    if (pos) el.dataset.tipPos = pos;
    // Keep title in sync for AT; it gets stripped at hover-time.
    el.setAttribute("title", text);
    if (pos) el.setAttribute("aria-label", text);
  } else {
    delete el.dataset.tip;
    el.removeAttribute("title");
  }
}
