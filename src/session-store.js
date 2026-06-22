import { randomUUID } from "node:crypto";
import {
  appendFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import { resolveWithin } from "./path-sandbox.js";
import { initialWorkspace } from "./templates.js";

const SESSION_ID = /^[0-9a-f-]{36}$/i;

export class SessionStore {
  constructor(dataDir) {
    this.root = join(dataDir, "sessions");
  }

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  async list() {
    const entries = await readdir(this.root, { withFileTypes: true });
    const sessions = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        return await this.get(entry.name);
      } catch {
        return null;
      }
    }));
    return sessions.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create({ name, template = "blank", model }) {
    const cleanName = String(name || "").trim().slice(0, 80);
    if (!cleanName) throw new HttpError(400, "Nama sesi wajib diisi");
    if (!new Set(["blank", "dashboard"]).has(template)) throw new HttpError(400, "Template tidak valid");

    const id = randomUUID();
    const now = new Date().toISOString();
    const session = {
      id,
      name: cleanName,
      template,
      model,
      status: "ready",
      usage: {
        last: { promptTokens: 0, completionTokens: 0 },
        total: { promptTokens: 0, completionTokens: 0 },
      },
      createdAt: now,
      updatedAt: now,
      lastPrompt: "",
    };
    const sessionDir = this.sessionDir(id);
    const workspace = join(sessionDir, "workspace");
    await mkdir(workspace, { recursive: true });
    await mkdir(join(sessionDir, "checkpoints"), { recursive: true });
    await Promise.all(Object.entries(initialWorkspace(cleanName, template)).map(([path, content]) =>
      writeFile(join(workspace, path), content, "utf8")
    ));
    await Promise.all([
      atomicJson(join(sessionDir, "session.json"), session),
      atomicJson(join(sessionDir, "messages.json"), []),
    ]);
    return session;
  }

  async get(id) {
    this.assertId(id);
    try {
      return JSON.parse(await readFile(join(this.sessionDir(id), "session.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") throw new HttpError(404, "Sesi tidak ditemukan");
      throw error;
    }
  }

  async update(id, patch) {
    const current = await this.get(id);
    const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    await atomicJson(join(this.sessionDir(id), "session.json"), next);
    return next;
  }

  async remove(id) {
    await this.get(id);
    await rm(this.sessionDir(id), { recursive: true, force: true });
  }

  workspaceDir(id) {
    this.assertId(id);
    return join(this.sessionDir(id), "workspace");
  }

  async history(id) {
    await this.get(id);
    try {
      const value = JSON.parse(await readFile(join(this.sessionDir(id), "messages.json"), "utf8"));
      return Array.isArray(value) ? value : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async saveHistory(id, messages) {
    await atomicJson(join(this.sessionDir(id), "messages.json"), messages);
  }

  async saveOptimizedHistory(id, messages, meta = {}) {
    await atomicJson(join(this.sessionDir(id), "messages.optimized.json"), {
      _view: "optimized",
      _generatedAt: new Date().toISOString(),
      ...meta,
      messages,
    });
  }

  async appendLlmRequestLog(id, entry) {
    await this.get(id);
    const path = join(this.sessionDir(id), "llm-requests.ndjson");
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  async createCheckpoint(id, historyLength) {
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const destination = join(this.sessionDir(id), "checkpoints", stamp);
    await mkdir(destination, { recursive: true });
    await cp(this.workspaceDir(id), join(destination, "workspace"), { recursive: true });
    await atomicJson(join(destination, "meta.json"), { historyLength, createdAt: new Date().toISOString() });
    return stamp;
  }

  async discardCheckpoint(id, checkpoint) {
    if (!checkpoint || !/^[0-9]+-[0-9a-f]{8}$/i.test(checkpoint)) return;
    await rm(join(this.sessionDir(id), "checkpoints", checkpoint), { recursive: true, force: true });
  }

  async undo(id) {
    await this.get(id);
    const root = join(this.sessionDir(id), "checkpoints");
    const entries = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    if (!entries.length) throw new HttpError(409, "Belum ada perubahan yang dapat di-undo");

    const checkpoint = join(root, entries[0]);
    const meta = JSON.parse(await readFile(join(checkpoint, "meta.json"), "utf8"));
    const workspace = this.workspaceDir(id);
    await rm(workspace, { recursive: true, force: true });
    await cp(join(checkpoint, "workspace"), workspace, { recursive: true });
    const history = await this.history(id);
    await this.saveHistory(id, history.slice(0, meta.historyLength));
    await rm(checkpoint, { recursive: true, force: true });
    await this.update(id, { status: "ready" });
    return { restored: entries[0] };
  }

  async listFiles(id) {
    await this.get(id);
    const root = this.workspaceDir(id);
    const files = [];
    await walk(root, async (fullPath, info) => {
      files.push({ path: relative(root, fullPath).split("\\").join("/"), size: info.size });
    });
    return files.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readWorkspaceFile(id, path) {
    await this.get(id);
    const fullPath = await resolveWithin(this.workspaceDir(id), path);
    return readFile(fullPath, "utf8");
  }

  async writeWorkspaceFile(id, path, content) {
    await this.get(id);
    if (typeof content !== "string") throw new HttpError(400, "Content file tidak valid");
    if (content.length > 2_000_000) throw new HttpError(413, "File terlalu besar");
    const fullPath = await resolveWithin(this.workspaceDir(id), path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, "utf8");
    await this.update(id, { status: "ready" });
  }

  async checkpointCount(id) {
    try {
      const entries = await readdir(join(this.sessionDir(id), "checkpoints"), { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).length;
    } catch {
      return 0;
    }
  }

  sessionDir(id) {
    this.assertId(id);
    return join(this.root, id);
  }

  assertId(id) {
    if (!SESSION_ID.test(String(id))) throw new HttpError(400, "ID sesi tidak valid");
  }
}

async function walk(dir, onFile) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) await walk(fullPath, onFile);
    else if (entry.isFile()) await onFile(fullPath, await stat(fullPath));
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
