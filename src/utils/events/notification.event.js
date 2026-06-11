import { EventEmitter } from "node:events";
import * as dbService from "../../DB/db.service.js";
import notificationModel from "../../DB/Model/notification.model.js";
import { childLogger } from "../logger/logger.js";
import { sendPushToUsers } from "../push/push.service.js";
import { shouldDeliver } from "../../modules/notification/service/preferences.service.js";
import { sendNotificationEmail } from "../email/notification.email.js";

const log = childLogger("notification-event");

export const notificationEvent = new EventEmitter();

// ─────────────────────────────────────────────────────────────
// Transport registry
// ─────────────────────────────────────────────────────────────
/**
 * Inverted dependency: the utility layer doesn't know about Socket.IO
 * (or any other delivery channel). The socket module — at boot time —
 * registers a transport function here. createNotification then calls
 * the registered transport without ever importing modules/socket.
 *
 * If no transport is registered, notifications are still persisted to
 * the DB; the realtime push just doesn't happen (graceful degradation).
 *
 * Signature: `transport(room, event, payload) => void`
 */
let _transport = null;

export function setNotificationTransport(fn) {
  if (typeof fn !== "function") {
    throw new TypeError("notification transport must be a function");
  }
  _transport = fn;
}

/** For tests, or to disable realtime push at runtime. */
export function clearNotificationTransport() {
  _transport = null;
}

// ─────────────────────────────────────────────────────────────
// Core: create ONE notification
// ─────────────────────────────────────────────────────────────
/**
 * Saves to DB and emits via Socket.IO to the recipient if online.
 * Never throws — all errors are caught and logged.
 */
const createNotification = async ({
  recipientId,
  triggeredById,
  type,
  title,
  body = null,
  entityType,
  entityId,
}) => {
  try {
    // Never notify yourself
    if (recipientId.toString() === triggeredById.toString()) return;

    // Save to DB
    const notification = await dbService.create({
      model: notificationModel,
      data: {
        recipient: recipientId,
        triggeredBy: triggeredById,
        type,
        title,
        body,
        entityType,
        entityId,
      },
    });

    // Populate triggeredBy for the socket payload
    const populated = await dbService.findOne({
      model: notificationModel,
      filter: { _id: notification._id },
      populate: [{ path: "triggeredBy", select: "username image" }],
    });

    // Respect the recipient's notification preferences. inApp ALWAYS
    // gets persisted (the row already saved above) so the bell badge
    // works even when the user has disabled both push and realtime
    // for this type — they'll see it on next page load.
    const [wantInApp, wantPush, wantEmail] = await Promise.all([
      shouldDeliver({ userId: recipientId, type, channel: "inApp" }),
      shouldDeliver({ userId: recipientId, type, channel: "push" }),
      shouldDeliver({ userId: recipientId, type, channel: "email" }),
    ]);

    // Realtime push to the socket transport (the in-app surface). Skip
    // when the user has turned in-app off — they still get the DB row
    // but no toast.
    if (wantInApp && _transport) {
      try {
        _transport(`user_${recipientId}`, "notification", {
          notification: populated,
        });
      } catch (err) {
        // Transport failure must never break the notification flow
        log.warn({ err, recipientId }, "notification transport push failed");
      }
    }

    // Native push (FCM/web) fan-out. Stub-safe — if firebase creds are
    // missing, sendPushToUsers just logs. We don't await aggressively
    // because the user-visible record is already saved + socket-pushed.
    if (wantPush) {
      sendPushToUsers([recipientId], {
        title,
        body: body || "",
        data: {
          type,
          entityType: entityType || "",
          entityId: entityId ? String(entityId) : "",
          notificationId: String(populated._id),
        },
      }).catch((err) =>
        log.warn({ err, recipientId }, "push fan-out failed"),
      );
    }

    // Email fan-out — rate-limited per recipient inside the helper.
    // Same fire-and-forget pattern: failures don't roll back the rest.
    if (wantEmail) {
      sendNotificationEmail({
        userId: recipientId,
        title,
        body,
        entityType,
        entityId,
      }).catch((err) =>
        log.warn({ err, recipientId }, "email fan-out failed"),
      );
    }
  } catch (err) {
    log.error({ err, type, recipientId }, "createNotification failed");
  }
};

// ─────────────────────────────────────────────────────────────
// Core: create notifications for MULTIPLE recipients at once
// ─────────────────────────────────────────────────────────────
const notifyMany = (recipientIds, payload) =>
  Promise.all(
    recipientIds.map((recipientId) =>
      createNotification({ recipientId, ...payload }),
    ),
  );

// ─────────────────────────────────────────────────────────────
// COMMENT LISTENERS
// ─────────────────────────────────────────────────────────────

/**
 * Emitted by: comment.service → createComment
 * Payload: { watcherIds, triggeredById, commenterName, taskTitle, taskId, commentContent }
 * Who gets it: all task watchers (assignee + anyone who commented before)
 */
/**
 * Emitted by: reminders.job → fireOne
 * Who gets it: the creator of the reminder
 */
/**
 * Meeting lifecycle notifications (Teams-style calendar pings).
 */
notificationEvent.on("meeting_invited", async (payload) => {
  const { recipientId, triggeredById, meetingId, title, startTime } = payload;
  await createNotification({
    recipientId,
    triggeredById,
    type: "meeting_invited",
    title: `📅 You're invited: ${title}`,
    body: `Starts ${new Date(startTime).toLocaleString()}`,
    entityType: "Meeting",
    entityId: meetingId,
  });
});

notificationEvent.on("meeting_starting_soon", async (payload) => {
  const { recipientId, triggeredById, meetingId, title, startTime } = payload;
  await createNotification({
    recipientId,
    triggeredById,
    type: "meeting_starting_soon",
    title: `⏰ Starting soon: ${title}`,
    body: `${new Date(startTime).toLocaleTimeString()}`,
    entityType: "Meeting",
    entityId: meetingId,
  });
});

notificationEvent.on("meeting_cancelled", async (payload) => {
  const { recipientId, triggeredById, meetingId, title } = payload;
  await createNotification({
    recipientId,
    triggeredById,
    type: "meeting_cancelled",
    title: `❌ Cancelled: ${title}`,
    body: null,
    entityType: "Meeting",
    entityId: meetingId,
  });
});

notificationEvent.on("reminder_due", async (payload) => {
  const { recipientId, text, sourceRoomId, sourceMessageId, reminderId } =
    payload;
  await createNotification({
    recipientId,
    triggeredById: recipientId, // self
    type: "reminder_due",
    title: "⏰ Reminder",
    body: text,
    entityType: sourceMessageId
      ? "Message"
      : sourceRoomId
        ? "ChatRoom"
        : "Reminder",
    entityId: sourceMessageId || sourceRoomId || reminderId,
  });
});

notificationEvent.on("comment_added", async (payload) => {
  const {
    watcherIds,
    triggeredById,
    commenterName,
    taskTitle,
    taskId,
    commentContent,
  } = payload;

  await notifyMany(watcherIds, {
    triggeredById,
    type: "comment_added",
    title: `${commenterName} commented on "${taskTitle}"`,
    body: commentContent.substring(0, 100),
    entityType: "Task",
    entityId: taskId,
  });
});

/**
 * Emitted by: comment.service → createComment (when parentComment exists)
 * Payload: { recipientId, triggeredById, replierName, commentContent, taskId }
 * Who gets it: the author of the parent comment only
 */
notificationEvent.on("comment_reply", async (payload) => {
  const { recipientId, triggeredById, replierName, commentContent, taskId } =
    payload;

  await createNotification({
    recipientId,
    triggeredById,
    type: "comment_reply",
    title: `${replierName} replied to your comment`,
    body: commentContent.substring(0, 100),
    entityType: "Task",
    entityId: taskId,
  });
});

/**
 * Emitted by: comment.service → createComment (when mentions.length > 0)
 * Payload: { mentionedUserIds, triggeredById, commenterName, taskTitle, taskId, commentContent }
 * Who gets it: each mentioned user
 */
notificationEvent.on("comment_mention", async (payload) => {
  const {
    mentionedUserIds,
    triggeredById,
    commenterName,
    taskTitle,
    taskId,
    commentContent,
  } = payload;

  await notifyMany(mentionedUserIds, {
    triggeredById,
    type: "comment_mention",
    title: `${commenterName} mentioned you in "${taskTitle}"`,
    body: commentContent.substring(0, 100),
    entityType: "Task",
    entityId: taskId,
  });
});

/**
 * Emitted by: shared.message.service → createMessage (when content has @mentions)
 * Payload: { mentionedUserIds, triggeredById, roomId, messageId, contentPreview }
 * Who gets it: each mentioned user in the chat room
 */
notificationEvent.on("message_mention", async (payload) => {
  const {
    mentionedUserIds,
    triggeredById,
    roomId,
    messageId,
    contentPreview,
  } = payload;

  await notifyMany(mentionedUserIds, {
    triggeredById,
    type: "message_mention",
    title: "You were mentioned in a chat",
    body: contentPreview,
    entityType: "Message",
    entityId: messageId,
    // chatRoomId travels in `meta` only on the saved record (we don't
    // have a Mixed `meta` field on Notification yet; if you add one,
    // include roomId here so the FE can deep-link).
  });
});

// ─────────────────────────────────────────────────────────────
// TASK LISTENERS
// ─────────────────────────────────────────────────────────────

/**
 * Emitted by: task.service → assignTask
 * Payload: { recipientId, triggeredById, assignerName, taskTitle, taskId }
 * Who gets it: the newly assigned user
 */
notificationEvent.on("task_assigned", async (payload) => {
  const { recipientId, triggeredById, assignerName, taskTitle, taskId } =
    payload;

  await createNotification({
    recipientId,
    triggeredById,
    type: "task_assigned",
    title: `${assignerName} assigned you to "${taskTitle}"`,
    body: null,
    entityType: "Task",
    entityId: taskId,
  });
});

/**
 * Emitted by: task.service → updateTaskStatus
 * Payload: { watcherIds, triggeredById, changerName, taskTitle, taskId, newStatus }
 * Who gets it: all task watchers
 */
notificationEvent.on("task_status_changed", async (payload) => {
  const {
    watcherIds,
    triggeredById,
    changerName,
    taskTitle,
    taskId,
    newStatus,
  } = payload;

  await notifyMany(watcherIds, {
    triggeredById,
    type: "task_status_changed",
    title: `"${taskTitle}" moved to ${newStatus}`,
    body: `Updated by ${changerName}`,
    entityType: "Task",
    entityId: taskId,
  });
});

/**
 * Emitted by: task.service → updateDueDate
 * Payload: { recipientId, triggeredById, taskTitle, taskId, newDueDate }
 * Who gets it: task assignee
 */
notificationEvent.on("task_due_date_changed", async (payload) => {
  const { recipientId, triggeredById, taskTitle, taskId, newDueDate } = payload;

  await createNotification({
    recipientId,
    triggeredById,
    type: "task_due_date_changed",
    title: `Due date changed for "${taskTitle}"`,
    body: `New due date: ${new Date(newDueDate).toLocaleDateString()}`,
    entityType: "Task",
    entityId: taskId,
  });
});

// ─────────────────────────────────────────────────────────────
// PROJECT LISTENERS
// ─────────────────────────────────────────────────────────────

/**
 * Emitted by: project.service → addMember
 * Payload: { recipientId, triggeredById, adderName, projectName, projectId }
 */
notificationEvent.on("project_member_added", async (payload) => {
  const { recipientId, triggeredById, adderName, projectName, projectId } =
    payload;

  await createNotification({
    recipientId,
    triggeredById,
    type: "project_member_added",
    title: `You were added to project "${projectName}"`,
    body: `Added by ${adderName}`,
    entityType: "Project",
    entityId: projectId,
  });
});

/**
 * Emitted by: project.service → removeMember
 * Payload: { recipientId, triggeredById, projectName, projectId }
 */
notificationEvent.on("project_member_removed", async (payload) => {
  const { recipientId, triggeredById, projectName, projectId } = payload;

  await createNotification({
    recipientId,
    triggeredById,
    type: "project_member_removed",
    title: `You were removed from project "${projectName}"`,
    body: null,
    entityType: "Project",
    entityId: projectId,
  });
});

// ─────────────────────────────────────────────────────────────
// TEAM LISTENERS
// ─────────────────────────────────────────────────────────────

/**
 * Emitted by: team.service → addMember
 * Payload: { recipientId, triggeredById, adderName, teamName, teamId }
 */
notificationEvent.on("team_member_added", async (payload) => {
  const { recipientId, triggeredById, adderName, teamName, teamId } = payload;

  await createNotification({
    recipientId,
    triggeredById,
    type: "team_member_added",
    title: `You were added to team "${teamName}"`,
    body: `Added by ${adderName}`,
    entityType: "Team",
    entityId: teamId,
  });
});

/**
 * Emitted by: team.service → removeMember
 * Payload: { recipientId, triggeredById, teamName, teamId }
 */
notificationEvent.on("team_member_removed", async (payload) => {
  const { recipientId, triggeredById, teamName, teamId } = payload;

  await createNotification({
    recipientId,
    triggeredById,
    type: "team_member_removed",
    title: `You were removed from team "${teamName}"`,
    body: null,
    entityType: "Team",
    entityId: teamId,
  });
});

// ─────────────────────────────────────────────────────────────
// SPRINT LISTENERS
// ─────────────────────────────────────────────────────────────

/**
 * Emitted by: sprint.service → startSprint
 * Payload: { memberIds, triggeredById, sprintName, sprintId }
 */
notificationEvent.on("sprint_started", async (payload) => {
  const { memberIds, triggeredById, sprintName, sprintId } = payload;

  await notifyMany(memberIds, {
    triggeredById,
    type: "sprint_started",
    title: `Sprint "${sprintName}" has started`,
    body: null,
    entityType: "Sprint",
    entityId: sprintId,
  });
});

/**
 * Emitted by: sprint.service → closeSprint
 * Payload: { memberIds, triggeredById, sprintName, sprintId }
 */
notificationEvent.on("sprint_closed", async (payload) => {
  const { memberIds, triggeredById, sprintName, sprintId } = payload;

  await notifyMany(memberIds, {
    triggeredById,
    type: "sprint_closed",
    title: `Sprint "${sprintName}" has been closed`,
    body: null,
    entityType: "Sprint",
    entityId: sprintId,
  });
});
