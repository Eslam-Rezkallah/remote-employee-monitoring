import mongoose, { Schema, model, Types } from "mongoose";
import { NotificationEntityTypes } from "./constants/entityTypes.js";

// ── Notification Types ────────────────────────────────────────
export const notificationTypes = {
  // Comments
  COMMENT_ADDED: "comment_added",       // someone commented on your task
  COMMENT_REPLY: "comment_reply",       // someone replied to your comment
  COMMENT_MENTION: "comment_mention",   // someone mentioned you in a comment

  // Tasks
  TASK_ASSIGNED: "task_assigned",                 // task assigned to you
  TASK_UPDATED: "task_updated",                   // task you watch was updated
  TASK_STATUS_CHANGED: "task_status_changed",     // status changed on your task
  TASK_DUE_DATE_CHANGED: "task_due_date_changed", // due date changed on your task

  // Projects
  PROJECT_MEMBER_ADDED: "project_member_added",
  PROJECT_MEMBER_REMOVED: "project_member_removed",

  // Teams
  TEAM_MEMBER_ADDED: "team_member_added",
  TEAM_MEMBER_REMOVED: "team_member_removed",

  // Sprints
  SPRINT_STARTED: "sprint_started",
  SPRINT_CLOSED: "sprint_closed",
};

const notificationSchema = new Schema(
  {
    // Who receives this notification
    recipient: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Who triggered this notification
    triggeredBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Notification type
    type: {
      type: String,
      enum: Object.values(notificationTypes),
      required: true,
    },

    // Short title shown in the bell dropdown — e.g. "John commented on TASK-1"
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Optional body — truncated preview of the content
    body: {
      type: String,
      trim: true,
      maxlength: 300,
      default: null,
    },

    // What entity this notification links to
    entityType: {
      type: String,
      enum: Object.values(NotificationEntityTypes),
      required: true,
    },
    // The ID of that entity — used to build the deep link in the frontend
    entityId: {
      type: Types.ObjectId,
      required: true,
      refPath: "entityType",
    },

    // Read state
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },

    // Soft delete
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────────
// Primary query: bell dropdown — recipient's unread, newest first
notificationSchema.index({ recipient: 1, isDeleted: 1, isRead: 1, createdAt: -1 });

// List all (read + unread) for a recipient
notificationSchema.index({ recipient: 1, isDeleted: 1, createdAt: -1 });

// Group notifications by entity (for future grouping like Jira)
notificationSchema.index({ entityId: 1, type: 1 });

const notificationModel =
  mongoose.models.Notification || model("Notification", notificationSchema);

export default notificationModel;