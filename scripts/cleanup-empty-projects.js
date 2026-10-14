import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { config } from "../src/config/config.js";

const SESSION_ID = /^[0-9a-f-]{36}$/i;
const args = process.argv.slice(2);
const unknownArgs = args.filter((arg) => !["--dry-run", "--apply"].includes(arg));
if (unknownArgs.length || (args.includes("--dry-run") && args.includes("--apply"))) {
  console.error("Usage: npm run cleanup:empty-projects [--dry-run | --apply]");
  process.exitCode = 2;
} else {
  const dryRun = !args.includes("--apply");
  const sessionsDir = join(config.dataDir, "sessions");
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const quarantineDir = join(config.dataDir, "migrations", "quarantine", "empty-projects", runId);
  const reportPath = join(config.dataDir, "migrations", "cleanup-empty-projects", `${runId}.json`);

  try {
    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const report = {
      version: "cleanup-empty-projects-v1",
      mode: dryRun ? "dry-run" : "apply",
      scannedAt: new Date().toISOString(),
      sessionsScanned: 0,
      candidates: [],
      skippedWorking: [],
      skippedInvalid: [],
      moved: [],
      skippedChanged: [],
      errors: [],
      quarantineDir: dryRun ? null : quarantineDir,
    };

    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue;
      report.sessionsScanned++;
      const candidate = await inspectCandidate(sessionsDir, entry.name);
      if (candidate.skipReason === "working") {
        report.skippedWorking.push(entry.name);
        continue;
      }
      if (candidate.skipReason) {
        report.skippedInvalid.push({ sessionId: entry.name, reason: candidate.skipReason });
        continue;
      }
      if (!candidate.eligible) continue;
      report.candidates.push(candidate.summary);
    }

    if (!dryRun) {
      await mkdir(quarantineDir, { recursive: true });
      for (const candidate of report.candidates) {
        const fresh = await inspectCandidate(sessionsDir, candidate.sessionId);
        if (fresh.skipReason || !fresh.eligible) {
          report.skippedChanged.push({ sessionId: candidate.sessionId, reason: fresh.skipReason || "project no longer empty" });
          continue;
        }

        try {
          await rename(join(sessionsDir, candidate.sessionId), join(quarantineDir, candidate.sessionId));
          report.moved.push(candidate);
          // Persist progress after each move so an interrupted run remains auditable.
          await atomicJson(reportPath, report);
        } catch (error) {
          report.errors.push({ sessionId: candidate.sessionId, error: error.message });
        }
      }
      report.appliedAt = new Date().toISOString();
      await atomicJson(reportPath, report);
    }

    console.log(JSON.stringify({ dataDir: config.dataDir, report, ...(dryRun ? {} : { reportPath }) }, null, 2));
    if (dryRun) {
      console.log("Dry run only; no projects were moved. Add --apply to move candidates into quarantine.");
    } else {
      console.log(`Moved ${report.moved.length} project(s) to quarantine. Their data is preserved at ${quarantineDir}.`);
    }
    if (report.errors.length) process.exitCode = 1;
  } catch (error) {
    console.error(`Empty-project cleanup failed: ${error.message}`);
    process.exitCode = 1;
  }
}

async function inspectCandidate(sessionsDir, id) {
  const sessionPath = join(sessionsDir, id, "session.json");
  let session;
  try {
    session = JSON.parse(await readFile(sessionPath, "utf8"));
  } catch (error) {
    return { eligible: false, skipReason: error.code === "ENOENT" ? "session.json missing" : "session.json unreadable or invalid" };
  }
  if (session.id !== id) return { eligible: false, skipReason: "session ID does not match directory" };
  if (session.status === "working") return { eligible: false, skipReason: "working" };
  if (session.frames !== undefined && !Array.isArray(session.frames)) {
    return { eligible: false, skipReason: "frames field is invalid" };
  }

  const frameCount = Array.isArray(session.frames) ? session.frames.length : 0;
  if (frameCount > 0) return { eligible: false };

  const workspaceFileCount = await countWorkspaceFiles(join(sessionsDir, id, "workspace"));
  if (workspaceFileCount > 0) return { eligible: false };

  return {
    eligible: true,
    summary: {
      sessionId: id,
      name: String(session.name || "").slice(0, 80),
      ownerId: session.ownerId || null,
      status: session.status || null,
      createdAt: session.createdAt || null,
      updatedAt: session.updatedAt || null,
      frameCount,
      workspaceFileCount,
    },
  };
}

async function countWorkspaceFiles(root) {
  let info;
  try {
    info = await lstat(root);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  // Treat a symlink or non-directory workspace as content; don't follow it.
  if (!info.isDirectory()) return 1;

  let count = 0;
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else count++;
    }
  }
  return count;
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}
