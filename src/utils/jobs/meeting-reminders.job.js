/**
 * utils/jobs/meeting-reminders.job.js
 *
 * Sends "starting in N minutes" pings 5 minutes before each meeting,
 * then flips meetings whose startTime has passed into "started" state
 * so the FE can show a "Join now" button.
 *
 * Same atomic claim pattern as the other cron jobs.
 */

import meetingModel, {
  meetingStatus,
} from "../../DB/Model/meeting.model.js";
import { notificationEvent } from "../events/notification.event.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("meeting-cron");

const TICK_INTERVAL_MS = Number(process.env.MEETING_TICK_MS || 60_000);
const REMINDER_LEAD_MS = Number(
  process.env.MEETING_REMINDER_LEAD_MS || 5 * 60 * 1000,
);

let cronHandle = null;

async function pushReminders() {
  // Meetings starting within REMINDER_LEAD_MS whose reminder hasn't
  // gone out yet. Compound-index hit.
  const window = new Date(Date.now() + REMINDER_LEAD_MS);
  const due = await meetingModel
    .find({
      status: meetingStatus.Scheduled,
      reminderSent: false,
      startTime: { $lte: window },
      isDeleted: false,
    })
    .limit(200)
    .lean();

  for (const m of due) {
    // Atomic flag flip so two cron instances don't double-notify.
    const claim = await meetingModel.updateOne(
      { _id: m._id, reminderSent: false },
      { $set: { reminderSent: true } },
    );
    if (claim.modifiedCount === 0) continue;

    for (const inv of m.invitees || []) {
      if (inv.status === "declined") continue;
      notificationEvent.emit("meeting_starting_soon", {
        recipientId: String(inv.userId),
        triggeredById: m.organizerId,
        meetingId: m._id,
        title: m.title,
        startTime: m.startTime,
      });
    }
  }
}

async function flipStarted() {
  const now = new Date();
  const res = await meetingModel.updateMany(
    {
      status: meetingStatus.Scheduled,
      startTime: { $lte: now },
      isDeleted: false,
    },
    { $set: { status: meetingStatus.Started } },
  );
  if (res.modifiedCount) {
    log.info({ count: res.modifiedCount }, "meetings transitioned to started");
  }
}

async function tick() {
  try {
    await pushReminders();
    await flipStarted();
  } catch (err) {
    log.error({ err }, "meeting cron tick failed");
  }
}

export function startMeetingRemindersJob() {
  if (cronHandle) return;
  log.info({ intervalMs: TICK_INTERVAL_MS }, "meeting reminders job started");
  cronHandle = setInterval(tick, TICK_INTERVAL_MS);
  if (cronHandle.unref) cronHandle.unref();
}

export function stopMeetingRemindersJob() {
  if (cronHandle) {
    clearInterval(cronHandle);
    cronHandle = null;
  }
}
