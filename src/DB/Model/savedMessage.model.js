import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

/**
 * SavedMessage — per-user bookmarks of chat messages (Slack-style
 * "Save for later"). Kept as its own collection (not an array on
 * Message) because:
 *   • saves are user-scoped, not message-scoped — embedding scales
 *     poorly when a popular message gets bookmarked by hundreds
 *   • listing "my saved messages" is a hot path; an indexed
 *     userId-keyed collection serves it in O(log n)
 *
 * One row per (user, message) — enforced by the unique compound index.
 */
const savedMessageSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    messageId: {
      type: Types.ObjectId,
      ref: "Message",
      required: true,
    },
    // Cached so "list my bookmarks grouped by room" doesn't need
    // a join to Message on the hot path.
    chatRoomId: {
      type: Types.ObjectId,
      ref: "ChatRoom",
      required: true,
      index: true,
    },
    // Optional user note attached to the bookmark (Slack lets you
    // add a reminder note when saving).
    note: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);

// Idempotent saves — `addToSet`-like behavior via DB constraint.
savedMessageSchema.index({ userId: 1, messageId: 1 }, { unique: true });

// "List my bookmarks newest first"
savedMessageSchema.index({ userId: 1, createdAt: -1 });

// "List my bookmarks in a specific room"
savedMessageSchema.index({ userId: 1, chatRoomId: 1, createdAt: -1 });

const savedMessageModel =
  mongoose.models.SavedMessage || model("SavedMessage", savedMessageSchema);

export default savedMessageModel;
