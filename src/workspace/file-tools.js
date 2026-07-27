import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { resolveWithin } from "./path-sandbox.js";
import { captureWebpageScreenshot } from "../media/web-screenshot.js";

export function createFileTools(workspaceDir, onMutation = () => {}, options = {}) {
  const tools = [
    tool("list_dir", "List files and folders inside a workspace directory (non-recursive).", {
      type: "object",
      properties: { path: { type: "string", description: "Relative path; defaults to the workspace root" } },
      additionalProperties: false,
    }, async ({ path = "." }) => {
      const fullPath = await resolveWithin(workspaceDir, path);
      const entries = await readdir(fullPath, { withFileTypes: true });
      return entries.map((entry) => `${entry.isDirectory() ? "d" : "-"} ${entry.name}`).join("\n") || "(kosong)";
    }),
    tool("grep", "Search for a pattern (regex) across text files in the workspace, recursively. Returns matching lines prefixed by relative path and line number (path:line: match). Use this to find usages of a class/function/variable, locate where something is defined, or audit references before refactoring.", {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression to search for (JavaScript regex syntax, e.g. 'btn-primary', 'function \\w+\\(', 'TODO').",
        },
        path: {
          type: "string",
          description: "Relative directory or file to search in; defaults to the workspace root.",
        },
        case_insensitive: {
          type: "boolean",
          description: "Case-insensitive match. Default false.",
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 500,
          description: "Maximum number of matching lines to return. Default 200.",
        },
      },
      required: ["pattern"],
      additionalProperties: false,
    }, async ({ pattern, path = ".", case_insensitive = false, max_results = 200 }) => {
      const flags = case_insensitive ? "gi" : "g";
      let regex;
      try {
        regex = new RegExp(pattern, flags);
      } catch (error) {
        throw new Error(`Pattern regex tidak valid: ${error.message}`);
      }
      const limit = Math.min(Math.max(Number(max_results) || 200, 1), 500);
      const rootPath = await resolveWithin(workspaceDir, path);
      const results = [];
      let scannedFiles = 0;
      await walkTextFiles(rootPath, async (fullPath) => {
        scannedFiles++;
        // Stop early once we have enough matches.
        if (results.length >= limit) return;
        const rel = relative(rootPath, fullPath).split("\\").join("/");
        let content;
        try {
          content = await readFile(fullPath, "utf8");
        } catch {
          return; // skip unreadable / non-text
        }
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          // Reset lastIndex because the regex has the global flag.
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            // Truncate very long lines so output stays readable.
            const line = lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i];
            results.push(`${rel}:${i + 1}: ${line}`);
            if (results.length >= limit) break;
          }
        }
      });
      if (!results.length) {
        return scannedFiles > 0 ? `(tidak ada match di ${scannedFiles} file)` : "(tidak ada file untuk dicari)";
      }
      const suffix = results.length >= limit ? `\n…(dibatasi ${limit} hasil, mungkin masih ada)` : "";
      return `${results.join("\n")}${suffix}`;
    }),
    tool("read_file", "Read a UTF-8 text file from the workspace. Use this before editing an existing file.", {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the workspace" },
        offset: { type: "integer", minimum: 1, description: "Starting line number, 1-based" },
        limit: { type: "integer", minimum: 1, maximum: 2000, description: "Maximum number of lines to return" },
      },
      required: ["path"],
      additionalProperties: false,
    }, async ({ path, offset, limit }) => {
      const fullPath = await resolveWithin(workspaceDir, path);
      const content = await readFile(fullPath, "utf8");
      if (content.length > 300_000 && offset === undefined && limit === undefined) {
        return "Error: file terlalu besar; gunakan offset dan limit";
      }
      if (offset === undefined && limit === undefined) return content;
      const lines = content.split("\n");
      const start = (offset ?? 1) - 1;
      return lines.slice(start, limit ? start + limit : undefined).join("\n");
    }),
    tool("write_file", "Create or overwrite a text file. Parent directories are created automatically. The parameter is named `path` (NOT `file`); `file` is only used by create_frame. CRITICAL: always emit `path` BEFORE `content` in the JSON object (e.g. {\"path\":\"index.html\",\"content\":\"...\"}) so the preview can stream live — if `content` comes first, the preview cannot update until the whole file finishes.", {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the workspace (this parameter is named 'path', not 'file'). Emit this FIRST in the JSON object, before content." },
        content: { type: "string", description: "Full file contents. Emit this AFTER path in the JSON object." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    }, async ({ path, content }) => {
      if (!path || !String(path).trim()) {
        throw new Error("Parameter 'path' wajib diisi (mis. 'index.html'). Catatan: parameter ini bernama 'path', bukan 'file' — 'file' hanya dipakai oleh create_frame.");
      }
      if (typeof content !== "string" || content.length > 2_000_000) throw new Error("Content file tidak valid atau terlalu besar");
      const fullPath = await resolveWithin(workspaceDir, path);
      await assertNotDirectory(fullPath, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf8");
      await onMutation(path);
      return `Berhasil menulis ${content.length} byte ke ${path}`;
    }, true),
    tool("edit_file", "Replace unique text inside a file. Include enough surrounding context so old_string matches only once. The parameter is named `path` (NOT `file`). Always emit `path` FIRST in the JSON object so the editing frame can be identified early.", {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the workspace (this parameter is named 'path', not 'file'). Emit this FIRST in the JSON object." },
        old_string: { type: "string", description: "Exact text to replace" },
        new_string: { type: "string", description: "Replacement text" },
        replace_all: { type: "boolean", description: "Replace every occurrence; default false" },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    }, async ({ path, old_string, new_string, replace_all = false }) => {
      if (!path || !String(path).trim()) {
        throw new Error("Parameter 'path' wajib diisi (mis. 'index.html'). Catatan: parameter ini bernama 'path', bukan 'file'.");
      }
      if (old_string === new_string) throw new Error("old_string dan new_string identik");
      const fullPath = await resolveWithin(workspaceDir, path);
      await assertNotDirectory(fullPath, path);
      const content = await readFile(fullPath, "utf8");
      const first = content.indexOf(old_string);
      if (first < 0) throw new Error("old_string tidak ditemukan");
      if (!replace_all && content.indexOf(old_string, first + old_string.length) >= 0) {
        throw new Error("old_string tidak unik; tambahkan konteks atau gunakan replace_all");
      }
      const next = replace_all
        ? content.split(old_string).join(new_string)
        : content.slice(0, first) + new_string + content.slice(first + old_string.length);
      if (next.length > 2_000_000) throw new Error("Hasil file terlalu besar");
      await writeFile(fullPath, next, "utf8");
      await onMutation(path);
      return `Berhasil mengedit ${toRelative(workspaceDir, fullPath)}`;
    }, true),
    tool("copy_file", "Copy a file inside the workspace.", {
      type: "object",
      properties: {
        source: { type: "string", description: "Source file path" },
        destination: { type: "string", description: "Destination file path" },
      },
      required: ["source", "destination"],
      additionalProperties: false,
    }, async ({ source, destination }) => {
      const [sourcePath, destinationPath] = await Promise.all([
        resolveWithin(workspaceDir, source),
        resolveWithin(workspaceDir, destination),
      ]);
      await mkdir(dirname(destinationPath), { recursive: true });
      await copyFile(sourcePath, destinationPath);
      await onMutation(destination);
      return `Berhasil menyalin ${source} ke ${destination}`;
    }, true),
    tool("delete_file", "Delete a file or directory from the workspace. Use this when the user asks to remove, clean up, or delete a file. By default deletes a single file; set recursive=true to delete a directory and everything inside it. The path must already exist.", {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path of the file or directory to delete",
        },
        recursive: {
          type: "boolean",
          description: "If true and the path is a directory, delete it and all of its contents. Ignored for files. Default false.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    }, async ({ path, recursive = false }) => {
      const fullPath = await resolveWithin(workspaceDir, path);
      const info = await stat(fullPath);
      const isDirectory = info.isDirectory();
      // Guard: never allow deleting a directory non-recursively — it would fail
      // and the error from rm is cryptic. Force the caller to opt in explicitly.
      if (isDirectory && !recursive) {
        throw new Error(`Path ${path} adalah direktori. Set recursive=true untuk menghapus direktori beserta isinya.`);
      }
      await rm(fullPath, { recursive: isDirectory ? Boolean(recursive) : false, force: false });
      await onMutation(path);
      return isDirectory
        ? `Berhasil menghapus direktori ${path} beserta isinya`
        : `Berhasil menghapus ${path}`;
    }, true),
    ...(options.onCreateFrame ? [
      tool(
        "create_frame",
        "Register a new preview frame in the canvas. A frame displays one HTML file from the workspace as a live preview the user can see. EXCLUSIVE TOOL: when you call create_frame, it must be the only tool call in that assistant response. Do not call write_file, edit_file, read_file, list_dir, or any other tool in the same response. Wait for the create_frame result, then write that file's content with write_file in the next assistant turn. Call this once per distinct page/surface you create. The `file` must end in .html or .htm. Use a meaningful filename since the frame title is derived from it (e.g. dashboard.html -> 'dashboard').",
        {
          type: "object",
          properties: {
            file: {
              type: "string",
              description: "Relative path of the HTML file this frame previews (e.g. index.html, dashboard.html)",
            },
            device: {
              type: "string",
              enum: ["desktop", "tablet", "mobile"],
              description: "Initial device size for the frame. Defaults to desktop.",
            },
          },
          required: ["file"],
          additionalProperties: false,
        },
        async ({ file, device }) => {
          const cleanFile = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "");
          if (!/\.html?$/i.test(cleanFile)) {
            return { result: `Error: file harus berakhiran .html atau .htm (diterima: ${file})` };
          }
          const frame = await options.onCreateFrame({ file: cleanFile, device });
          return { result: `Frame dibuat untuk ${cleanFile} (device: ${frame.device}). Sekarang tulis isi file tersebut dengan write_file.`, frame };
        },
        true,
      ),
    ] : []),
    ...(options.onDeleteFrame ? [
      tool(
        "delete_frame",
        "Remove a preview frame from the canvas without deleting its HTML file. Use this when the user asks to remove/hide/delete a frame. Prefer `frame_id` when known; otherwise pass the HTML `file` shown by the frame.",
        {
          type: "object",
          properties: {
            frame_id: {
              type: "string",
              description: "ID of the frame to remove",
            },
            file: {
              type: "string",
              description: "Relative path of the HTML file whose frame should be removed (e.g. index.html)",
            },
          },
          additionalProperties: false,
        },
        async ({ frame_id, file }) => {
          const cleanFrameId = String(frame_id || "").trim();
          const cleanFile = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
          if (!cleanFrameId && !cleanFile) {
            return { result: "Error: isi frame_id atau file untuk menghapus frame" };
          }
          const output = await options.onDeleteFrame({
            frameId: cleanFrameId || undefined,
            file: cleanFile || undefined,
          });
          return {
            result: `Frame dihapus${output?.removed?.file ? ` untuk ${output.removed.file}` : ""}.`,
            frames: output?.frames,
          };
        },
        true,
      ),
    ] : []),
    ...(options.webScreenshot?.enabled ? [
      tool(
        "capture_webpage_screenshot",
        "Capture a public website URL as a PNG screenshot, save it inside the session workspace, and make the image available as visual context. Use this when the user asks to recreate, imitate, inspect, or take inspiration from a website URL.",
        {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Full public http or https URL of the webpage to capture",
            },
          },
          required: ["url"],
          additionalProperties: false,
        },
        async ({ url }) => {
          const image = await captureWebpageScreenshot({
            workspaceDir,
            url,
            endpoint: options.webScreenshot.endpoint,
            signal: options.signal,
          });
          await onMutation(image.path);
          return {
            result: `Screenshot ${image.sourceUrl} disimpan ke ${image.path} (${image.size} byte)`,
            artifacts: [{ kind: "image", ...image }],
          };
        },
        true,
      ),
    ] : []),
  ];

  return {
    schemas: tools.map(({ name, description, parameters }) => ({
      type: "function",
      function: { name, description, parameters },
    })),
    async execute(name, rawArguments) {
      const selected = tools.find((item) => item.name === name);
      if (!selected) return { result: `Error: tool ${name} tidak tersedia`, mutated: false };
      try {
        const args = rawArguments?.trim() ? JSON.parse(rawArguments) : {};
        const output = await selected.execute(args);
        if (output && typeof output === "object" && !Buffer.isBuffer(output)) {
          return {
            result: String(output.result || "").slice(0, 400_000),
            mutated: selected.mutates,
            artifacts: Array.isArray(output.artifacts) ? output.artifacts : [],
            ...(output.frame ? { frame: output.frame } : {}),
            ...(Array.isArray(output.frames) ? { frames: output.frames } : {}),
          };
        }
        return { result: String(output).slice(0, 400_000), mutated: selected.mutates, artifacts: [] };
      } catch (error) {
        return { result: `Error: ${error.message}`, mutated: false, artifacts: [] };
      }
    },
  };
}

function tool(name, description, parameters, execute, mutates = false) {
  return { name, description, parameters, execute, mutates };
}

function toRelative(root, path) {
  return relative(root, path).split("\\").join("/");
}

/** Reject write/edit targets that resolve to an existing directory (EISDIR guard). */
async function assertNotDirectory(fullPath, requestedPath) {
  try {
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      throw new Error(`'${requestedPath}' adalah direktori yang sudah ada, bukan file. Gunakan nama file lengkap (mis. '${requestedPath}/index.html') atau pilih path lain.`);
    }
  } catch (error) {
    // ENOENT = path tidak ada → aman, lanjut (akan dibuat). Re-throw error lain.
    if (error.code !== "ENOENT") throw error;
  }
}

// Max file size we'll grep into; larger files are likely binary/minified and
// would blow up memory/time on a per-line scan.
const GREP_MAX_FILE_BYTES = 1_000_000;
// Extensions treated as text. Anything else is skipped to avoid dumping
// matches out of base64 images, fonts, etc.
const GREP_TEXT_EXT = /\.(?:html?|css|js|mjs|cjs|ts|jsx|tsx|json|svg|md|txt|csv|xml|yml|yaml|webmanifest|ini|env|gitignore)$/i;

/**
 * Recursively walk a directory and invoke onFile for each text file (by
 * extension + size guard). Used by the grep tool. Skips dotfiles/dotdirs
 * (same convention as SessionStore.walk) to avoid scanning hidden clutter.
 */
async function walkTextFiles(dir, onFile) {
  // If the path is itself a file, check it directly instead of readdir.
  let info;
  try {
    info = await stat(dir);
  } catch {
    return;
  }
  if (info.isFile()) {
    if (GREP_TEXT_EXT.test(dir) && info.size <= GREP_MAX_FILE_BYTES) {
      await onFile(dir);
    }
    return;
  }
  // Otherwise it's a directory – walk recursively.
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTextFiles(fullPath, onFile);
    } else if (entry.isFile() && GREP_TEXT_EXT.test(entry.name)) {
      let info;
      try {
        info = await stat(fullPath);
      } catch {
        continue;
      }
      if (info.size <= GREP_MAX_FILE_BYTES) await onFile(fullPath);
    }
  }
}
