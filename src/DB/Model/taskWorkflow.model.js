import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

/**
 * TaskWorkflow — custom Kanban states per space.
 *
 * Jira lets every project define its own status list ("To Do", "In
 * Review", "QA", "Done", etc.). We model that as a per-space document.
 *
 * Backwards-compat strategy:
 *   • If a space has NO workflow, tasks use the hardcoded default
 *     statuses from task.model.js (Todo / InProgress / Done). The
 *     space behaves exactly like it did before this feature shipped.
 *   • The instant a space owner creates a workflow, every task in
 *     that space starts validating its `status` against the workflow.
 *     Migration tip: include the legacy three statuses in the new
 *     workflow's first version to avoid invalidating existing tasks.
 *
 * Schema choices:
 *   • Statuses are an ordered array (drag-drop reordering in the UI
 *     maps to changing the index).
 *   • Each status carries its own `category` ("todo" | "in_progress"
 *     | "done") — that's what burndown/velocity reports group by, so
 *     reports don't break when a team adds an exotic state like "QA".
 *   • One workflow per space, enforced by a unique partial index.
 */

export const statusCategories = {
  Todo: "todo",
  InProgress: "in_progress",
  Done: "done",
};

const statusSchema = new Schema(
  {
    // The literal stored on task.status. Keep stable — renaming
    // breaks every task using it.
    key: { type: String, required: true, trim: true, maxlength: 40 },
    // Display label (free-form). Safe to rename.
    label: { type: String, required: true, trim: true, maxlength: 60 },
    // Reports collapse all statuses into these three buckets.
    category: {
      type: String,
      enum: Object.values(statusCategories),
      required: true,
    },
    // Optional UI hint (hex color or token like "blue.500").
    color: { type: String, default: null, maxlength: 20 },
    // 0-based position; used for drag-and-drop column ordering.
    order: { type: Number, required: true, min: 0 },
    // When true, this is the default state new tasks land in.
    // Exactly one isDefault=true is enforced at write time.
    isDefault: { type: Boolean, default: false },
  },
  { _id: true },
);

const taskWorkflowSchema = new Schema(
  {
    spaceId: {
      type: Types.ObjectId,
      ref: "Space",
      required: true,
    },
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    name: { type: String, default: "Default workflow", maxlength: 100 },

    // Jira-style: a workflow can apply to ALL task types (when null) or
    // to a SPECIFIC type (Task / Bug / Story / Epic). The resolver in
    // task.permissions picks the most specific workflow:
    //   1. Workflow matching the task's `type` exactly,
    //   2. else the workflow with `appliesTo = null` (the space default),
    //   3. else fall back to hardcoded enum.
    // Letting workflows narrow by type means a team can have "Bug" go
    // through QA gates the "Task" workflow doesn't enforce.
    appliesTo: {
      type: String,
      enum: ["Task", "Bug", "Story", "Epic", null],
      default: null,
    },

    statuses: {
      type: [statusSchema],
      validate: {
        // Guards against an empty workflow (would brick the space).
        validator: (arr) => Array.isArray(arr) && arr.length >= 2,
        message: "A workflow needs at least 2 statuses",
      },
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One workflow per (space, appliesTo) pair. The unique partial index
// treats `null` appliesTo as one slot — that's the space default.
taskWorkflowSchema.index(
  { spaceId: 1, appliesTo: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } },
);

const taskWorkflowModel =
  mongoose.models.TaskWorkflow ||
  model("TaskWorkflow", taskWorkflowSchema);

export default taskWorkflowModel;
