// Thumbnail generator: render a "fit-all" view of a session's canvas frames
// as a static PNG. The approach is server-side headless Chrome over the
// existing /preview/:id/:file route — same primitive the export feature uses.
//
// Flow:
//   1. Compute the fit-all bounding box from persisted frames (mirror of
//      canvas.js fitAll math).
//   2. Build a self-contained HTML layout page (served via the internal
//      /__thumb_layout/:id route in server.js) that places one same-origin
//      iframe per frame at its world position over a grid background.
//   3. captureFullPage() renders that page to a PNG Buffer.
//
// Zero new dependencies. If Chrome is unavailable, captureFullPage throws
// and the caller is expected to swallow the error (best-effort).

import { captureFullPage } from "./screenshot.js";
import { frameDimensions } from "./session-store.js";

// Output target size (longest side). The layout page is rendered at fit-all
// scale, then Chrome captures it at the natural pixel size; we keep the
// result as-is. Bumped down only by MAX_EXPORT_WIDTH to bound memory.
const MAX_LAYOUT_WIDTH = 2560;
const PADDING = 40; // px around frames (matches frontend fitAll pad)

/**
 * Compute the fit-all bounding box from a list of frames.
 * Returns { minX, minY, width, height } in canvas-world px, or null if empty.
 */
export function computeLayoutBox(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const frame of frames) {
    const { w, h } = frameDimensions(frame);
    const x = Number(frame.x) || 0;
    const y = Number(frame.y) || 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX,
    minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * Build the HTML layout page that places one iframe per frame at fit-all
 * positions. This page is served by the /__thumb_layout/:id route and
 * captured by Chrome headless. Background mirrors the canvas grid theme.
 *
 * @param {object} options
 * @param {string} options.id         Session id.
 * @param {Array}  options.frames     Persisted frames (with file/device/x/y).
 * @param {number} options.port       Server port (for building 127.0.0.1 iframe URLs).
 * @returns {{ html: string, width: number, height: number }}
 */
export function buildLayoutHtml({ id, frames, port }) {
  const box = computeLayoutBox(frames);
  if (!box) return { html: emptyLayoutHtml(), width: 1, height: 1 };

  const pageWidth = Math.min(MAX_LAYOUT_WIDTH, Math.ceil(box.width + PADDING * 2));
  // Translate world coords → page coords by shifting -minX/-minY + padding.
  const originX = box.minX - PADDING;
  const originY = box.minY - PADDING;

  const iframeNodes = frames.map((frame) => {
    const { w, h } = frameDimensions(frame);
    const x = (Number(frame.x) || 0) - originX;
    const y = (Number(frame.y) || 0) - originY;
    const file = String(frame.file || "index.html").replace(/"/g, "");
    const src = `http://127.0.0.1:${port}/preview/${id}/${encodeURIComponent(file)}?thumb=${Date.now()}`;
    return `<iframe class="frame" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px" src="${src}" loading="eager"></iframe>`;
  }).join("\n");

  // Background uses the same dark grid as the canvas (.session-preview /
  // .canvas-area) so the thumbnail matches the in-app look.
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>thumb</title>
<style>
  html, body { margin: 0; padding: 0; background: #131b17; }
  body {
    position: relative;
    width: ${pageWidth}px;
    min-height: ${Math.ceil(box.height + PADDING * 2)}px;
    background-image: radial-gradient(rgba(133,151,141,.18) 0.7px, transparent 0.7px);
    background-size: 14px 14px;
    background-position: 0 0;
  }
  .frame {
    position: absolute;
    border: 1px solid rgba(133,151,141,.35);
    border-radius: 6px;
    background: #fff;
    overflow: hidden;
  }
</style>
</head>
<body>
${iframeNodes}
</body>
</html>`;
  return { html, width: pageWidth, height: Math.ceil(box.height + PADDING * 2) };
}

function emptyLayoutHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#131b17}</style></head><body></body></html>`;
}

/**
 * Render a fit-all thumbnail PNG for a session by screenshotting the internal
 * layout page. Resolves to a PNG Buffer, or null if the session has no frames.
 * Throws if Chrome is unavailable (caller should swallow best-effort).
 *
 * Note: the layout page must be reachable from headless Chrome via
 * http://127.0.0.1:<port>/__thumb_layout/:id — server.js registers that route.
 *
 * @param {object} options
 * @param {string} options.id
 * @param {Array}  options.frames
 * @param {number} options.port
 * @returns {Promise<Buffer|null>}
 */
export async function generateThumbnail({ id, frames, port }) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  const { width } = buildLayoutHtml({ id, frames, port });
  const layoutUrl = `http://127.0.0.1:${port}/__thumb_layout/${id}`;
  // captureFullPage grows height to content; we just need the rendered page.
  const buffer = await captureFullPage({ url: layoutUrl, width });
  return buffer;
}
