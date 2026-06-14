/**
 * utils/jobs/idle.detection.job.js
 *
 * Runs on a configurable interval (default 30 s).
 * For each active in-memory session it checks whether the user
 * has been idle longer than IDLE_THRESHOLD_SEC.
 *
 * Design goals
 * ────────────
 *  • No DB read on every tick  — we read from the in-memory store.
 *  • Batch DB writes           — bulkWrite once per tick, not once per session.
 *  • Accurate idle accounting  — idle seconds accumulate in-memory and are
 *                                flushed to MongoDB only when dirty.
 *  • Crash recovery            — lastHeartbeatAt is written to DB every
 *                                HEARTBEAT_FLUSH_INTERVAL_SEC so a restart
 *                                can detect orphaned sessions.
 */

import workSessionModel from "../../DB/Model/worksession.model.js";
import {
  getAllActive,
  updateSession,
} from "../cache/session.store.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("idle-detection");

/* ── tuneable constants ───────────────────────────────────── */
export const IDLE_THRESHOLD_SEC       = Number(process.env.IDLE_THRESHOLD_SEC       || 60);
export const CRON_INTERVAL_MS         = Number(process.env.CRON_INTERVAL_MS         || 30_000);
export const HEARTBEAT_FLUSH_INTERVAL_SEC = Number(
  process.env.HEARTBEAT_FLUSH_INTERVAL_SEC || 60
);

let cronHandle = null;

/* ── main tick ────────────────────────────────────────────── */
async function tick() {
  const now        = Date.now();
  const nowSec     = Math.floor(now / 1000);
  const bulkOps    = [];

  for (const entry of await getAllActive()) {
    const {
      sessionId,
      lastActivityAt,
      isIdle,
      idleSince,
      accruedIdle,
      lastHeartbeat,
    } = entry;

    const secondsSinceActivity = Math.floor((now - lastActivityAt) / 1000);
    const becameIdle = !isIdle && secondsSinceActivity >= IDLE_THRESHOLD_SEC;
    const wasAlreadyIdle = isIdle;

    /* ── newly idle ─────────────────────────────────────── */
    if (becameIdle) {
      await updateSession(sessionId, {
        isIdle:    true,
        idleSince: lastActivityAt + IDLE_THRESHOLD_SEC * 1000, // exact moment
        dirty:     true,
      });
      bulkOps.push({
        updateOne: {
          filter: { _id: sessionId },
          update: {
            $set: {
              isIdle:          true,
              lastHeartbeatAt: new Date(now),
            },
          },
        },
      });
      continue;
    }

    /* ── still idle: accumulate idle seconds ────────────── */
    if (wasAlreadyIdle && idleSince) {
      // Add idle seconds accrued since last cron tick
      const newIdleSec = Math.floor((now - idleSince) / 1000);
      const delta = newIdleSec - (accruedIdle || 0);

      if (delta > 0) {
        await updateSession(sessionId, { accruedIdle: newIdleSec, dirty: true });
        bulkOps.push({
          updateOne: {
            filter: { _id: sessionId },
            update: {
              $inc: { idleSeconds: delta },
              $set: { lastHeartbeatAt: new Date(now) },
            },
          },
        });
      }
      continue;
    }

    /* ── active: flush heartbeat periodically ───────────── */
    const secSinceHeartbeatFlush = Math.floor((now - (lastHeartbeat || 0)) / 1000);
    if (secSinceHeartbeatFlush >= HEARTBEAT_FLUSH_INTERVAL_SEC) {
      await updateSession(sessionId, { lastHeartbeat: now });
      bulkOps.push({
        updateOne: {
          filter: { _id: sessionId },
          update: { $set: { lastHeartbeatAt: new Date(now) } },
        },
      });
    }
  }

  /* ── single batched DB write ─────────────────────────── */
  if (bulkOps.length > 0) {
    try {
      await workSessionModel.bulkWrite(bulkOps, { ordered: false });
    } catch (err) {
      // Log but do not crash — next tick will retry
      log.error({ err, ops: bulkOps.length }, "bulkWrite failed");
    }
  }
}

/* ── lifecycle ────────────────────────────────────────────── */
export function startIdleDetection() {
  if (cronHandle) return; // already running
  log.info(
    { thresholdSec: IDLE_THRESHOLD_SEC, intervalMs: CRON_INTERVAL_MS },
    "idle detection started",
  );
  cronHandle = setInterval(tick, CRON_INTERVAL_MS);
  // Allow process to exit even if the interval is still running
  if (cronHandle.unref) cronHandle.unref();
}

export function stopIdleDetection() {
  if (cronHandle) {
    clearInterval(cronHandle);
    cronHandle = null;
  }
}

/* ── crash recovery (call once on server boot) ────────────── */
/**
 * Any session that:
 *  • has status = "active" or "paused"
 *  • AND lastHeartbeatAt is older than (IDLE_THRESHOLD_SEC * 5) seconds
 *
 * …is considered orphaned and is force-stopped.
 * This handles the case where the Node process crashed mid-session.
 */
export async function recoverOrphanedSessions() {
  const cutoff = new Date(
    Date.now() - IDLE_THRESHOLD_SEC * 5 * 1000
  );

  const orphans = await workSessionModel.find({
    status:          { $in: ["active", "paused"] },
    lastHeartbeatAt: { $lt: cutoff },
  }).lean();

  if (!orphans.length) return;

  const now = new Date();
  const bulkOps = orphans.map((s) => ({
    updateOne: {
      filter: { _id: s._id },
      update: {
        $set: {
          status:  "stopped",
          endTime: s.lastHeartbeatAt || now, // best approximation
          note:    "__auto_closed_on_recovery__",
        },
      },
    },
  }));

  await workSessionModel.bulkWrite(bulkOps, { ordered: false });
  log.warn({ count: orphans.length }, "closed orphaned sessions on recovery");
}