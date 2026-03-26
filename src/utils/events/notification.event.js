import { EventEmitter } from "node:events";
import * as dbService from "../../DB/db.service.js";
import notificationModel from "../../DB/Model/notification.model.js";
import { getIo } from "../../modules/socket/socket.controller.js";

export const notificationEvent = new EventEmitter();

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

    // Emit to the recipient's personal socket room if they are online
    try {
      const io = getIo();
      // Frontend must join room `user_<userId>` on connect
      io.to(`user_${recipientId}`).emit("notification", {
        notification: populated,
      });
    } catch (_) {
      // Socket not initialised or user offline — silently skip
    }
  } catch (err) {
    console.error(
      `[notificationEvent] createNotification error (type: ${type}):`,
      err.message,
    );
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
