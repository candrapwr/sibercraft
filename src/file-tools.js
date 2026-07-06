import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { resolveWithin } from "./path-sandbox.js";
import { captureWebpageScreenshot } from "./web-screenshot.js";

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
    tool("write_file", "Create or overwrite a text file. Parent directories are created automatically.", {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the workspace" },
        content: { type: "string", description: "Full file contents" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    }, async ({ path, content }) => {
      if (typeof content !== "string" || content.length > 2_000_000) throw new Error("Content file tidak valid atau terlalu besar");
      const fullPath = await resolveWithin(workspaceDir, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf8");
      await onMutation(path);
      return `Berhasil menulis ${content.length} byte ke ${toRelative(workspaceDir, fullPath)}`;
    }, true),
    tool("edit_file", "Replace unique text inside a file. Include enough surrounding context so old_string matches only once.", {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the workspace" },
        old_string: { type: "string", description: "Exact text to replace" },
        new_string: { type: "string", description: "Replacement text" },
        replace_all: { type: "boolean", description: "Replace every occurrence; default false" },
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false,
    }, async ({ path, old_string, new_string, replace_all = false }) => {
      if (old_string === new_string) throw new Error("old_string dan new_string identik");
      const fullPath = await resolveWithin(workspaceDir, path);
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
    ...(options.onCreateFrame ? [
      tool(
        "create_frame",
        "Register a new preview frame in the canvas. A frame displays one HTML file from the workspace as a live preview the user can see. Call this once per distinct page/surface you create, then write that file's content with write_file. The `file` must end in .html or .htm. Use a meaningful filename since the frame title is derived from it (e.g. dashboard.html -> 'dashboard').",
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
