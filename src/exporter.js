import { readFile } from "node:fs/promises";
import { dirname, extname, posix } from "node:path";
import { resolveWithin } from "./path-sandbox.js";

export async function buildStandaloneHtml(workspaceDir) {
  const entryPath = await resolveWithin(workspaceDir, "index.html");
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
