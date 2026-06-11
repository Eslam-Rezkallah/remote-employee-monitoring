/**
 * utils/jobs/scheduled-messages.job.js
 *
 * Promotes due scheduled-messages into real Messages.
 *
 * Cadence:  every 30 seconds (matches the user-facing minimum send-delay
 *           buffer enforced by the scheduleMessage validator).
 * Batching: claim up to BATCH_SIZE pending rows whose sendAt has passed,
 *           process them serially through the shared message service so
 *           each one runs through mention extraction / replyCount /
 *           notification fan-out exactly like a live message.
 *
 * Crash safety:
 *   We atomically flip status `pending → processing` per row BEFORE
 *   doing any work, so two cron ticks (or two instances) won't race on
 *   the same row. A `processing` row that's older than STALE_AFTER_MS
 *   is assumed orphaned (the worker died mid-send) and gets reset back
 *   to `pending` for retry — capped at MAX_RETRIES to avoid loops.
 *
 *   Multi-instance note: the atomic `findOneAndUpdate({status:pending},
 *   {$set:{status:processing}})` is safe across Node instances because
 *   Mongo serializes the write per-document.
 */

import scheduledMessageModel, {
  scheduledMessageStatus,
} from "../../DB/Model/scheduledMessage.model.js";
import { createMessage } from "../../modules/message/service/shared.message.service.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("scheduled-messages");

const TICK_INTERVAL_MS = Number(
  process.env.SCHEDULED_MSG_TICK_MS || 30_000,
);
const BATCH_SIZE = Number(process.env.SCHEDULED_MSG_BATCH || 50);
const STALE_AFTER_MS = Number(
  process.env.SCHEDULED_MSG_STALE_MS || 5 * 60 * 1000, // 5 min
);
const MAX_RETRIES = Number(process.env.SCHEDULED_MSG_MAX_RETRIES || 3);

const PROCESSING = scheduledMessageStatus.Processing;

let cronHandle = null;

/**
 * Try to atomically claim ONE pending row whose sendAt has passed.
 * Returns the claimed row or null if the queue is empty.
 */
async function claimNext() {
  const now = new Date();
  return scheduledMessageModel.findOneAndUpdate(
    {
      status: scheduledMessageStatus.Pending,
      sendAt: { $lte: now },
    },
    {
      $set: { status: PROCESSING },
    },
    {
      // Pick the oldest-due row first so we don't starve anyone.
      sort: { sendAt: 1 },
      new: true,
    },
  );
}

/**
 * Recover rows stuck in `processing` longer than STALE_AFTER_MS.
 * Bumps a `meta.retries` counter so we eventually mark them failed
 * instead of looping forever.
 */
async function recoverStale() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);
  // Step 1: find candidates so we can decide retry vs. fail per row.
  const stuck = await scheduledMessageModel
    .find({ status: PROCESSING, updatedAt: { $lt: cutoff } })
    .select("_id failureReason")
    .lean();
  if (!stuck.length) return;

  for (const row of stuck) {
    // Use the failureReason field as a lightweight retry counter
    // (string "retry:N"). Cheap and avoids a schema migration.
    const m = /^retry:(\d+)/.exec(row.failureReason || "");
    const retries = m ? Number(m[1]) : 0;
    if (retries >= MAX_RETRIES) {
      await scheduledMessageModel.updateOne(
        { _id: row._id },
        {
          $set: {
            status: scheduledMessageStatus.Failed,
            failureReason: `gave up after ${retries} retries`,
          },
        },
      );
      log.warn({ id: row._id, retries }, "scheduled message failed after retries");
    } else {
      await scheduledMessageModel.updateOne(
        { _id: row._id },
        {
          $set: {
            status: scheduledMessageStatus.Pending,
            failureReason: `retry:${retries + 1}`,
          },
        },
      );
      log.info({ id: row._id, retries: retries + 1 }, "scheduled message requeued");
    }
  }
}

async function processClaimed(row) {
  try {
    const populated = await createMessage({
      roomId: row.chatRoomId,
      userId: row.senderId,
      content: row.content,
      messageType: row.messageType || "text",
      replyTo: row.replyTo || null,
    });

    await scheduledMessageModel.updateOne(
      { _id: row._id },
      {
        $set: {
          status: scheduledMessageStatus.Sent,
          sentAt: new Date(),
          deliveredMessageId: populated._id,
          failureReason: null,
        },
      },
    );

    log.debug(
      { id: row._id, messageId: populated._id, roomId: row.chatRoomId },
      "scheduled message delivered",
    );
  } catch (err) {
    // Per-row failure — do NOT throw, the tick keeps processing other rows.
    await scheduledMessageModel.updateOne(
      { _id: row._id },
      {
        $set: {
          status: scheduledMessageStatus.Failed,
          failureReason: (err.message || "unknown error").slice(0, 500),
        },
      },
    );
    log.error({ err, id: row._id }, "scheduled message delivery failed");
  }
}

async function tick() {
  try {
    await recoverStale();

    let processed = 0;
    while (processed < BATCH_SIZE) {
      const row = await claimNext();
      if (!row) break;
      await processClaimed(row);
      processed++;
    }
    if (processed > 0) {
      log.info({ processed }, "scheduled messages sent");
    }
  } catch (err) {
    // Tick-level failures (e.g., DB blip) — log + try again next tick.
    log.error({ err }, "scheduled messages tick failed");
  }
}

export function startScheduledMessagesJob() {
  if (cronHandle) return;
  log.info(
    { intervalMs: TICK_INTERVAL_MS, batchSize: BATCH_SIZE },
    "scheduled messages job started",
  );
  cronHandle = setInterval(tick, TICK_INTERVAL_MS);
  if (cronHandle.unref) cronHandle.unref();
}

export function stopScheduledMessagesJob() {
  if (cronHandle) {
    clearInterval(cronHandle);
    cronHandle = null;
  }
}
