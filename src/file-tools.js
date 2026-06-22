import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { resolveWithin } from "./path-sandbox.js";

export function createFileTools(workspaceDir, onMutation = () => {}) {
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
        const result = await selected.execute(args);
        return { result: String(result).slice(0, 400_000), mutated: selected.mutates };
      } catch (error) {
        return { result: `Error: ${error.message}`, mutated: false };
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
