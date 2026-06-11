/**
 * utils/jobs/reminders.job.js
 *
 * Fires due reminders by pushing a notification to the creator.
 *
 * Why separate from scheduled-messages.job.js:
 *   • reminders → push to ONE user (the creator)
 *   • scheduledMessages → post a real Message to a chat room
 * Different fan-out, different cancel semantics, different UX.
 *
 * Concurrency: same claim-then-process pattern (pending → processing
 * atomic flip) so two workers don't double-fire the same row.
 */

import reminderModel, {
  reminderStatus,
} from "../../DB/Model/reminder.model.js";
import { notificationEvent } from "../events/notification.event.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("reminders-cron");

const TICK_INTERVAL_MS = Number(process.env.REMINDERS_TICK_MS || 30_000);
const BATCH_SIZE = Number(process.env.REMINDERS_BATCH || 100);

let cronHandle = null;

async function claimNext() {
  return reminderModel.findOneAndUpdate(
    {
      status: reminderStatus.Pending,
      triggerAt: { $lte: new Date() },
    },
    { $set: { status: "processing" } },
    { sort: { triggerAt: 1 }, new: true },
  );
}

async function fireOne(row) {
  try {
    // Re-use the existing notification pipeline so the user's
    // preferences (push/email/in-app) are respected automatically.
    notificationEvent.emit("reminder_due", {
      recipientId: row.userId.toString(),
      reminderId: row._id,
      text: row.text,
      sourceRoomId: row.sourceRoomId ? row.sourceRoomId.toString() : null,
      sourceMessageId: row.sourceMessageId
        ? row.sourceMessageId.toString()
        : null,
    });

    await reminderModel.updateOne(
      { _id: row._id },
      {
        $set: {
          status: reminderStatus.Sent,
          sentAt: new Date(),
          failureReason: null,
        },
      },
    );
  } catch (err) {
    await reminderModel.updateOne(
      { _id: row._id },
      {
        $set: {
          status: reminderStatus.Failed,
          failureReason: (err.message || "unknown").slice(0, 500),
        },
      },
    );
    log.error({ err, id: row._id }, "reminder dispatch failed");
  }
}

async function tick() {
  let processed = 0;
  while (processed < BATCH_SIZE) {
    const row = await claimNext();
    if (!row) break;
    await fireOne(row);
    processed++;
  }
  if (processed) log.info({ processed }, "reminders fired");
}

export function startRemindersJob() {
  if (cronHandle) return;
  log.info({ intervalMs: TICK_INTERVAL_MS }, "reminders job started");
  cronHandle = setInterval(tick, TICK_INTERVAL_MS);
  if (cronHandle.unref) cronHandle.unref();
}

export function stopRemindersJob() {
  if (cronHandle) {
    clearInterval(cronHandle);
    cronHandle = null;
  }
}
