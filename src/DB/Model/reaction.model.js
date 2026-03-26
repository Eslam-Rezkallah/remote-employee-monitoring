import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const validReactions = ["👍", "❤️", "😂", "😮", "😢", "🔥", "👏", "😡"];

const reactionSchema = new Schema(
  {
    messageId: {
      type: Types.ObjectId,
      ref: "Message",
      required: true,
      index: true,
    },
    chatRoomId: {
      type: Types.ObjectId,
      ref: "ChatRoom",
      required: true,
      index: true,
    },
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    reaction: {
      type: String,
      required: true,
      trim: true,
      enum: validReactions,
    },
  },
  { timestamps: true },
);

// ── Indexes ────────────────────────────────────────────────────
// One reaction per user per message (upsert-safe)
reactionSchema.index({ messageId: 1, userId: 1 }, { unique: true });
reactionSchema.index({ messageId: 1, reaction: 1 });
reactionSchema.index({ chatRoomId: 1, messageId: 1 });

const reactionModel =
  mongoose.models.MessageReaction || model("MessageReaction", reactionSchema);

export default reactionModel;
