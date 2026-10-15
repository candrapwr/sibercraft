import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { resolveWithin } from "./path-sandbox.js";
import { captureWebpageScreenshot } from "../media/web-screenshot.js";
import { executeWebSearch } from "../ai/web-search.js";

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
    ...(options.webSearch?.enabled ? [
      tool("web_search", "Search the web and read page content through the Siber Exa-compatible API. Use mode \"search\" with a query to find current information and source URLs (up to 5 results). Use mode \"content\" with a URL from the search results or the user to retrieve readable page text. Search returns titles, URLs, publication dates, authors, and highlights; content returns the page title, URL, and text.", {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["search", "content"],
            description: "Use search to find relevant pages, then content to read a selected result.",
          },
          query: {
            type: "string",
            description: "Search query; required when mode is search.",
          },
          url: {
            type: "string",
            description: "Public http or https page URL; required when mode is content.",
          },
          maxCharacters: {
            type: "integer",
            minimum: 100,
            maximum: 15000,
            description: "Maximum extracted text length for mode content. Defaults to 500.",
          },
        },
        required: ["mode"],
        additionalProperties: false,
      }, async (args) => ({
        result: await executeWebSearch(args, {
          endpoint: options.webSearch.endpoint,
          apiKey: options.webSearch.apiKey,
          signal: options.signal,
        }),
      })),
    ] : []),
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
    tool("write_file", "Prepare a preview frame, then create or overwrite a text file. For an existing registered preview, FIRST call this tool with only `frame_id` and `path` as an exclusive tool call (no `content`). After the PREPARED result, call it again with `frame_id`, `path`, and `content`. A successful create_frame already prepares its frame, so its next write_file call may include content directly. For files unrelated to a preview, use an empty frame_id and include content directly. ALWAYS order arguments as frame_id, path, content. This two-step flow starts frame activity before a provider begins generating a large non-streamed content argument.", {
      type: "object",
      properties: {
        frame_id: { type: "string", description: "ID of the registered preview frame affected by this write. Emit this FIRST in the JSON object; use an empty string when no preview frame is associated with the file." },
        path: { type: "string", description: "File path relative to the workspace (this parameter is named 'path', not 'file'). Emit this after frame_id and before content." },
        content: { type: "string", description: "Full file contents. Omit this only for the first preview-preparation call; include it after path in the following write call." },
      },
      required: ["frame_id", "path"],
      additionalProperties: false,
    }, async ({ frame_id, path, content }) => {
      if (!path || !String(path).trim()) {
        throw new Error("Parameter 'path' wajib diisi (mis. 'index.html'). Catatan: parameter ini bernama 'path', bukan 'file' — 'file' hanya dipakai oleh create_frame.");
      }
      if (content === undefined) {
        const cleanFrameId = String(frame_id || "").trim();
        if (!cleanFrameId) throw new Error("frame_id wajib diisi untuk menyiapkan animasi preview sebelum write_file");
        if (!options.onPrepareFrame) throw new Error("Preview frame tidak dapat disiapkan");
        const frame = await options.onPrepareFrame({ frameId: cleanFrameId, path, operation: "write_file" });
        return {
          result: `[WRITE_FRAME_PREPARED] Frame ${frame.id} siap untuk ${path}. Sekarang panggil write_file lagi dengan frame_id dan path yang sama serta content lengkap; jangan panggil tahap persiapan lagi.`,
          mutated: false,
        };
      }
      if (typeof content !== "string" || content.length > 2_000_000) throw new Error("Content file tidak valid atau terlalu besar");
      const fullPath = await resolveWithin(workspaceDir, path);
      await assertNotDirectory(fullPath, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf8");
      await assertFileContent(fullPath, content, path);
      await onMutation(path);
      return `Berhasil menulis ${content.length} byte ke ${path}`;
    }, true),
    tool("edit_file", "Prepare a preview frame, then replace unique text inside a file. Use this for a small localized replacement; for a broad redesign requiring many replacements in one file, prefer read_file followed by one complete write_file. For a registered preview, FIRST call this tool with only `frame_id` and `path` as an exclusive tool call. After the EDIT_FRAME_PREPARED result, call it again with `frame_id`, `path`, `old_string`, and `new_string`. For files unrelated to a preview, use an empty frame_id and include the edit strings directly. ALWAYS order frame_id first and path second. Include enough surrounding context so old_string matches only once.", {
      type: "object",
      properties: {
        frame_id: { type: "string", description: "ID of the registered preview frame affected by this edit. Emit this FIRST; use an empty string when no preview frame is associated with the file." },
        path: { type: "string", description: "File path relative to the workspace (this parameter is named 'path', not 'file'). Emit this after frame_id." },
        old_string: { type: "string", description: "Exact text to replace. Omit together with new_string only for the preview-preparation call." },
        new_string: { type: "string", description: "Replacement text. Omit together with old_string only for the preview-preparation call." },
        replace_all: { type: "boolean", description: "Replace every occurrence; default false" },
      },
      required: ["frame_id", "path"],
      additionalProperties: false,
    }, async ({ frame_id, path, old_string, new_string, replace_all = false }) => {
      if (!path || !String(path).trim()) {
        throw new Error("Parameter 'path' wajib diisi (mis. 'index.html'). Catatan: parameter ini bernama 'path', bukan 'file'.");
      }
      if (old_string === undefined && new_string === undefined) {
        const cleanFrameId = String(frame_id || "").trim();
        if (!cleanFrameId) throw new Error("frame_id wajib diisi untuk menyiapkan animasi preview sebelum edit_file");
        if (!options.onPrepareFrame) throw new Error("Preview frame tidak dapat disiapkan");
        const frame = await options.onPrepareFrame({ frameId: cleanFrameId, path, operation: "edit_file" });
        return {
          result: `[EDIT_FRAME_PREPARED] Frame ${frame.id} siap untuk ${path}. Sekarang panggil edit_file lagi dengan frame_id dan path yang sama serta old_string dan new_string; jangan panggil tahap persiapan lagi.`,
          mutated: false,
        };
      }
      if (typeof old_string !== "string" || typeof new_string !== "string") {
        throw new Error("old_string dan new_string wajib diisi bersama untuk menjalankan edit_file");
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
      await assertFileContent(fullPath, next, path);
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
      const [sourceInfo, destinationInfo] = await Promise.all([stat(sourcePath), stat(destinationPath)]);
      if (sourceInfo.size !== destinationInfo.size) {
        throw new Error(`Verifikasi gagal setelah menyalin ${source} ke ${destination}`);
      }
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
      await assertMissing(fullPath, path);
      await onMutation(path);
      return isDirectory
        ? `Berhasil menghapus direktori ${path} beserta isinya`
        : `Berhasil menghapus ${path}`;
    }, true),
    ...(options.onCreateFrame ? [
      tool(
        "create_frame",
        "Register and prepare a new preview frame in the canvas. A frame displays one HTML file from the workspace as a live preview the user can see. EXCLUSIVE TOOL: when you call create_frame, it must be the only tool call in that assistant response. Do not call write_file, edit_file, read_file, list_dir, or any other tool in the same response. Wait for the create_frame result, then write that file's content with write_file in the next assistant turn; do not run write_file's separate preparation step because create_frame already prepared it. Call this once per distinct page/surface you create. The `file` must end in .html or .htm. Use a meaningful filename since the frame title is derived from it (e.g. dashboard.html -> 'dashboard').",
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
          const frameReference = frame?.id ? ` Frame ID: ${frame.id}. Frame ini sudah PREPARED; panggil write_file berikutnya langsung dengan {\"frame_id\":\"${frame.id}\",\"path\":\"${cleanFile}\",\"content\":\"...\"} dan jangan jalankan tahap persiapan lagi.` : "";
          const result = frame?.reused
            ? `Frame yang sudah ada dipakai untuk ${cleanFile} (device: ${frame.device}). Jangan buat frame kedua; lanjutkan dengan write_file bila perlu.${frameReference}`
            : `Frame dibuat untuk ${cleanFile} (device: ${frame.device}). Sekarang tulis isi file tersebut dengan write_file.${frameReference}`;
          return { result, frame };
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
      if (!selected) return { ok: false, result: `Error: tool ${name} tidak tersedia`, mutated: false, artifacts: [] };
      try {
        const args = rawArguments?.trim() ? JSON.parse(rawArguments) : {};
        const output = await selected.execute(args);
        if (output && typeof output === "object" && !Buffer.isBuffer(output)) {
          const result = String(output.result || "").slice(0, 400_000);
          const ok = !result.startsWith("Error:");
          return {
            ok,
            result,
            mutated: ok && (Object.hasOwn(output, "mutated") ? Boolean(output.mutated) : selected.mutates),
            artifacts: Array.isArray(output.artifacts) ? output.artifacts : [],
            ...(output.frame ? { frame: output.frame } : {}),
            ...(Array.isArray(output.frames) ? { frames: output.frames } : {}),
          };
        }
        return { ok: true, result: String(output).slice(0, 400_000), mutated: selected.mutates, artifacts: [] };
      } catch (error) {
        return { ok: false, result: `Error: ${error.message}`, mutated: false, artifacts: [] };
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

async function assertFileContent(fullPath, expected, requestedPath) {
  const actual = await readFile(fullPath, "utf8");
  if (actual !== expected) {
    throw new Error(`Verifikasi gagal setelah menulis ${requestedPath}`);
  }
}

async function assertMissing(fullPath, requestedPath) {
  try {
    await stat(fullPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Verifikasi gagal setelah menghapus ${requestedPath}`);
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
