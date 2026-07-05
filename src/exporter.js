import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, extname, join, posix, relative } from "node:path";
import { resolveWithin } from "./path-sandbox.js";
import { zipFile } from "./zip.js";

export async function buildStandaloneHtml(workspaceDir, entryFile = "index.html") {
  const entryPath = await resolveWithin(workspaceDir, entryFile);
  let html = await readFile(entryPath, "utf8");

  html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
    if (!/\brel\s*=\s*["'][^"']*stylesheet/i.test(tag)) return tag;
    const href = attribute(tag, "href");
    if (!isLocalReference(href)) return tag;
    const file = await readWorkspaceAsset(workspaceDir, href);
    if (!file) return tag;
    const css = await inlineCssUrls(file.content.toString("utf8"), workspaceDir, dirname(file.relativePath));
    return `<style data-sibercraft-source="${escapeAttribute(file.relativePath)}">\n${escapeClosingTag(css, "style")}\n</style>`;
  });

  html = await replaceAsync(html, /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, async (tag, before, src, after) => {
    if (!isLocalReference(src)) return tag;
    const file = await readWorkspaceAsset(workspaceDir, src);
    if (!file) return tag;
    const attributes = `${before} ${after}`.replace(/\bsrc\s*=\s*["'][^"']+["']/i, "").trim();
    return `<script${attributes ? ` ${attributes}` : ""} data-sibercraft-source="${escapeAttribute(file.relativePath)}">\n${escapeClosingTag(file.content.toString("utf8"), "script")}\n</script>`;
  });

  html = await replaceAsync(html, /<(?:img|source|video|audio|input)\b[^>]*>/gi, async (tag) => {
    const source = attribute(tag, "src");
    if (!isLocalReference(source)) return tag;
    const file = await readWorkspaceAsset(workspaceDir, source);
    if (!file) return tag;
    return replaceAttribute(tag, "src", toDataUri(file.relativePath, file.content));
  });

  html = await replaceAsync(html, /<video\b[^>]*>/gi, async (tag) => {
    const poster = attribute(tag, "poster");
    if (!isLocalReference(poster)) return tag;
    const file = await readWorkspaceAsset(workspaceDir, poster);
    if (!file) return tag;
    return replaceAttribute(tag, "poster", toDataUri(file.relativePath, file.content));
  });

  html = await replaceAsync(html, /<link\b[^>]*>/gi, async (tag) => {
    if (!/\brel\s*=\s*["'][^"']*(?:icon|apple-touch-icon)/i.test(tag)) return tag;
    const href = attribute(tag, "href");
    if (!isLocalReference(href)) return tag;
    const file = await readWorkspaceAsset(workspaceDir, href);
    if (!file) return tag;
    return replaceAttribute(tag, "href", toDataUri(file.relativePath, file.content));
  });

  html = await replaceAsync(html, /<style\b([^>]*)>([\s\S]*?)<\/style>/gi, async (_tag, attributes, css) => {
    const inlined = await inlineCssUrls(css, workspaceDir, ".");
    return `<style${attributes}>${escapeClosingTag(inlined, "style")}</style>`;
  });

  return html;
}

async function inlineCssUrls(css, workspaceDir, baseDir) {
  return replaceAsync(css, /url\(\s*(["']?)([^"')]+)\1\s*\)/gi, async (match, _quote, value) => {
    if (!isLocalReference(value)) return match;
    const reference = posix.join(baseDir.split("\\").join("/"), cleanReference(value));
    const file = await readWorkspaceAsset(workspaceDir, reference);
    return file ? `url("${toDataUri(file.relativePath, file.content)}")` : match;
  });
}

async function readWorkspaceAsset(workspaceDir, reference) {
  try {
    const relativePath = cleanReference(reference);
    const fullPath = await resolveWithin(workspaceDir, relativePath);
    return { relativePath, content: await readFile(fullPath) };
  } catch {
    return null;
  }
}

function cleanReference(value) {
  const clean = String(value || "").split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(clean).replace(/^\.\//, "");
  } catch {
    return clean.replace(/^\.\//, "");
  }
}

function isLocalReference(value) {
  return Boolean(value) && !/^(?:[a-z]+:|\/\/|#|\/)/i.test(String(value).trim());
}

function attribute(tag, name) {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1] || "";
}

function replaceAttribute(tag, name, value) {
  return tag.replace(new RegExp(`(\\b${name}\\s*=\\s*)["'][^"']+["']`, "i"), `$1"${value}"`);
}

function toDataUri(path, content) {
  return `data:${mimeType(path)};base64,${content.toString("base64")}`;
}

function mimeType(path) {
  return ({
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff",
    ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp3": "audio/mpeg", ".mp4": "video/mp4",
  })[extname(path).toLowerCase()] || "application/octet-stream";
}

function escapeClosingTag(value, tag) {
  return String(value).replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

/**
 * Collect a single HTML file plus all locally-referenced assets (CSS, JS, images)
 * as ZIP entries. Mirrors the dependency-resolution logic of buildStandaloneHtml,
 * but keeps files separate instead of inlining them.
 */
export async function buildFileZip(workspaceDir, entryFile = "index.html") {
  const entries = new Map(); // path -> Buffer (dedupe by relative path)
  const queue = [String(entryFile || "index.html")];
  const visited = new Set();

  while (queue.length) {
    const rel = queue.shift();
    if (visited.has(rel)) continue;
    visited.add(rel);
    const file = await readWorkspaceAsset(workspaceDir, rel);
    if (!file) continue;
    entries.set(file.relativePath, file.content);
    // If it's HTML, scan for local references to enqueue.
    if (/\.html?$/i.test(rel)) {
      const html = file.content.toString("utf8");
      const refs = extractLocalReferences(html);
      for (const ref of refs) queue.push(ref);
    } else if (/\.css$/i.test(rel)) {
      // CSS url() references — enqueue local ones.
      const css = file.content.toString("utf8");
      const base = posix.dirname(file.relativePath.split("\\").join("/"));
      for (const match of css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
        const value = match[2];
        if (!isLocalReference(value)) continue;
        queue.push(posix.join(base, cleanReference(value)));
      }
    }
  }

  return zipFile([...entries].map(([path, data]) => ({ path, data })));
}

/** Extract local href/src/ references from an HTML document. */
function extractLocalReferences(html) {
  const refs = [];
  const push = (value) => {
    if (isLocalReference(value)) refs.push(cleanReference(value));
  };
  for (const tag of html.matchAll(/<(?:link|script|img|source|video|audio|input)\b[^>]*>/gi)) {
    push(attribute(tag[0], "href"));
    push(attribute(tag[0], "src"));
  }
  return refs;
}

/**
 * Collect the ENTIRE workspace (all files recursively) as ZIP entries.
 * @param {string} workspaceDir
 * @param {Array<{path: string, data: Buffer}>} [extra] — additional entries (e.g. screenshots)
 */
export async function buildWorkspaceZip(workspaceDir, extra = []) {
  const entries = [];
  await walkWorkspace(workspaceDir, async (fullPath, info) => {
    if (!info.isFile()) return;
    const rel = relative(workspaceDir, fullPath).split("\\").join("/");
    if (rel.startsWith(".")) return;
    entries.push({ path: rel, data: await readFile(fullPath) });
  });
  for (const e of extra) {
    if (e?.path && e?.data) entries.push({ path: e.path, data: e.data });
  }
  return zipFile(entries);
}

async function walkWorkspace(dir, onFile) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) await walkWorkspace(fullPath, onFile);
    else if (entry.isFile()) await onFile(fullPath, await stat(fullPath));
  }
}

function escapeAttribute(value) {
  return String(value).replace(/[&"<>]/g, (char) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[char]);
}

async function replaceAsync(source, pattern, replacer) {
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return source;
  const replacements = await Promise.all(matches.map((match) => replacer(...match)));
  let result = "";
  let cursor = 0;
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    result += source.slice(cursor, match.index) + replacements[index];
    cursor = match.index + match[0].length;
  }
  return result + source.slice(cursor);
}
