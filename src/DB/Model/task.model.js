import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const taskTypes = {
  Task: "Task",
  Bug: "Bug",
  Story: "Story",
  Epic: "Epic",
};

export const taskStatus = {
  Todo: "Todo",
  InProgress: "InProgress",
  Done: "Done",
};

export const taskPriority = {
  Low: "Low",
  Medium: "Medium",
  High: "High",
  Urgent: "Urgent",
};

const taskSchema = new Schema(
  {
    // =========================
    // Core
    // =========================
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 200,
    },
    description: { type: String, default: "" },

    // =========================
    // Scope (Org/Space)
    // =========================
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    spaceId: {
      type: Types.ObjectId,
      ref: "Space",
      required: true,
      index: true,
    },

    // =========================
    // Sprint & Planning
    // =========================
    sprintId: {
      type: Types.ObjectId,
      ref: "Sprint",
      default: null,
      index: true,
    },
    points: {
      type: Number,
      default: 0,
      min: 0,
    },

    // =========================
    // Type / Status / Priority
    // =========================
    type: {
      type: String,
      enum: Object.values(taskTypes),
      default: taskTypes.Task,
    },
    status: {
      type: String,
      enum: Object.values(taskStatus),
      default: taskStatus.Todo,
    },
    priority: {
      type: String,
      enum: Object.values(taskPriority),
      default: taskPriority.Medium,
    },

    // =========================
    // People
    // =========================
    assigneeId: { type: Types.ObjectId, ref: "User", default: null },
    reporterId: { type: Types.ObjectId, ref: "User", required: true },

    // =========================
    // Dates
    // =========================
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },

    // =========================
    // Labels / Tags
    // =========================
    labels: [{ type: String, trim: true }],

    // =========================
    // Hierarchy (Parent/Child)
    // =========================
    parentTaskId: { type: Types.ObjectId, ref: "Task", default: null },

    // =========================
    // Relations
    // =========================
    comments: [{ type: Types.ObjectId, ref: "Comment" }],
    attachments: [{ type: Types.ObjectId, ref: "File" }],

    // =========================
    // Dependencies (Jira-style)
    // =========================
    // Both directions stored explicitly. We could derive `blocks`
    // from a reverse query on `blockedBy` but bidirectional storage
    // makes the "what does this unblock?" lookup O(1).
    // Kept in sync via the dependency service (atomic $addToSet /
    // $pull on BOTH sides in a transaction-equivalent pattern).
    blockedBy: [{ type: Types.ObjectId, ref: "Task" }],
    blocks: [{ type: Types.ObjectId, ref: "Task" }],

    // =========================
    // Soft delete
    // =========================
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// =========================
// Indexes (Performance)
// =========================

// Common lists: backlog / active work
taskSchema.index({ spaceId: 1, status: 1, isDeleted: 1 });
taskSchema.index({ spaceId: 1, priority: 1, isDeleted: 1 });
taskSchema.index({ spaceId: 1, assigneeId: 1, isDeleted: 1 });

// ✅ Assigned tasks endpoint (Phase 6)
taskSchema.index({
  organizationId: 1,
  spaceId: 1,
  assigneeId: 1,
  status: 1,
  isDeleted: 1,
});

// ✅ Calendar queries (Phase 5)
taskSchema.index({
  organizationId: 1,
  spaceId: 1,
  dueDate: 1,
  isDeleted: 1,
});

// ✅ Sprint analytics queries (Phase 8: report/burndown/velocity)
taskSchema.index({
  organizationId: 1,
  spaceId: 1,
  sprintId: 1,
  status: 1,
  isDeleted: 1,
});

// Keep these (still useful)
taskSchema.index({ spaceId: 1, sprintId: 1, isDeleted: 1 });
taskSchema.index({ organizationId: 1, sprintId: 1, isDeleted: 1 });

// Search
taskSchema.index({ title: "text", description: "text" });

// Parent → children (Epic > Story > Subtask trees)
taskSchema.index({ parentTaskId: 1, isDeleted: 1 });

// Dependency lookups
taskSchema.index({ blockedBy: 1 });
taskSchema.index({ blocks: 1 });

const taskModel = mongoose.models.Task || model("Task", taskSchema);
export default taskModel;
