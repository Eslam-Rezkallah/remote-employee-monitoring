import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const commentSchema = new Schema(
  {
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 8000,
    },
    task: {
      type: Types.ObjectId,
      ref: "Task",
      required: true,
    },
    createdBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    parentComment: {
      type: Types.ObjectId,
      ref: "Comment",
      default: null,
    },
    mentions: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// ── Indexes ──────────────────────────────────────────────────
commentSchema.index({ task: 1, createdAt: 1 }); // list comments for a task (asc for tree-build)
commentSchema.index({ task: 1, parentComment: 1, createdAt: 1 }); // threaded replies
commentSchema.index({ createdBy: 1, createdAt: -1 }); // user's own comments (profile / dashboard)

const commentModel = mongoose.models.Comment || model("Comment", commentSchema);

export default commentModel;
