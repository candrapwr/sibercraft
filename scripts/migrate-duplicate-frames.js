import { config } from "../src/config/config.js";
import { generateThumbnail } from "../src/media/thumbnail.js";
import { SessionStore } from "../src/workspace/session-store.js";

const args = process.argv.slice(2);
const unknownArgs = args.filter((arg) => !["--dry-run", "--apply", "--arrange", "--thumbnails"].includes(arg));
if (unknownArgs.length || (args.includes("--dry-run") && args.includes("--apply"))) {
  console.error("Usage: npm run migrate:duplicate-frames [--dry-run | --apply] [--arrange] [--thumbnails]");
  process.exitCode = 2;
} else {
  const dryRun = !args.includes("--apply");
  const arrange = args.includes("--arrange");
  const thumbnails = args.includes("--thumbnails");
  const store = new SessionStore(config.dataDir);

  try {
    await store.init();
    const result = await store.migrateDuplicateFramesOnce({ dryRun });
    let arrangement = null;
    let thumbnailRefresh = null;
    const groups = [
      ...(result.report?.duplicateGroups || []),
      ...(result.report?.previousDuplicateGroups || []),
    ];
    const affectedIds = new Set(groups.map((group) => group.sessionId).filter(Boolean));
    if (arrange) {
      const sessionIds = [...affectedIds];
      const removeFrameIdsBySession = {};
      for (const group of groups) {
        if (!group.sessionId) continue;
        removeFrameIdsBySession[group.sessionId] ||= [];
        removeFrameIdsBySession[group.sessionId].push(...(group.removedFrameIds || []).filter(Boolean));
      }
      arrangement = await store.arrangeDuplicateFramePositionsOnce({ sessionIds, dryRun, removeFrameIdsBySession });
      for (const change of arrangement.report?.positionChanges || []) {
        if (change.sessionId) affectedIds.add(change.sessionId);
      }
    }
    if (thumbnails) {
      const sessionIds = [...affectedIds];
      if (dryRun) {
        thumbnailRefresh = { dryRun: true, sessions: sessionIds };
      } else {
        thumbnailRefresh = { dryRun: false, refreshed: [], removed: [], failed: [] };
        for (const id of sessionIds) {
          try {
            const session = await store.get(id);
            const frames = Array.isArray(session.frames) ? session.frames : [];
            if (frames.length === 0) {
              await store.removeThumbnail(id);
              thumbnailRefresh.removed.push(id);
              continue;
            }
            const buffer = await generateThumbnail({ id, frames, port: config.port });
            if (!buffer) throw new Error("Thumbnail generator tidak menghasilkan gambar");
            await store.writeThumbnail(id, buffer);
            thumbnailRefresh.refreshed.push(id);
          } catch (error) {
            thumbnailRefresh.failed.push({ sessionId: id, error: error.message });
          }
        }
      }
    }
    console.log(JSON.stringify({
      dataDir: config.dataDir,
      deduplication: result,
      ...(arrange ? { arrangement } : {}),
      ...(thumbnails ? { thumbnailRefresh } : {}),
    }, null, 2));
    if (dryRun) {
      console.log("Dry run only; no session data or thumbnails changed. Add --apply to apply the listed changes.");
    } else if (result.alreadyApplied && (!arrangement || arrangement.alreadyApplied)) {
      console.log("The requested migration steps were already applied; no session data changed.");
    }
    if (thumbnailRefresh?.failed?.length) {
      console.error("One or more thumbnails could not be refreshed. Resolve the errors and rerun the same command.");
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Frame migration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
