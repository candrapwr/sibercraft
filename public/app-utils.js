export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeDownloadName(value) {
  return String(value || "sibercraft-export").trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "sibercraft-export";
}

export async function readNdjson(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

export function formatBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function formatCompactTokens(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(value);
}

export function renderMarkdown(value) {
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

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
