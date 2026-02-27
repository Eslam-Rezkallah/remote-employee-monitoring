import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const commentSchema = new Schema(
  {
    content: {
      type: String,
      required: true,
      trim: true,
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
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
   
    mentions: [{ type: Types.ObjectId, ref: "User" }],
  },
  {
    timestamps: true,
  },
);

commentSchema.index({ task: 1, createdAt: -1 });

const commentModel = mongoose.models.Comment || model("Comment", commentSchema);

export default commentModel;
