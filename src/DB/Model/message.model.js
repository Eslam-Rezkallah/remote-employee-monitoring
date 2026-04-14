import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const messageTypes = {
  text: "text",
  image: "image",
  voice: "voice",
  file: "file",
  system: "system",
};

// ── Sub-schemas ────────────────────────────────────────────────
const attachmentSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["image", "voice", "file", "video"],
      required: true,
    },
    url: { type: String, required: true },
    public_id: { type: String, default: null },
    originalName: { type: String, default: null },
    mimeType: { type: String, default: null },
    size: { type: Number, default: 0 },
    duration: { type: Number, default: null },
  },
  { _id: false },
);

const deliveredToSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true },
    deliveredAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const seenBySchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true },
    seenAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ── Main schema ────────────────────────────────────────────────
const messageSchema = new Schema(
  {
    chatRoomId: {
      type: Types.ObjectId,
      ref: "ChatRoom",
      required: true,
      index: true,
    },
    senderId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    content: { type: String, default: "", maxlength: 5000, trim: true },
    messageType: {
      type: String,
      enum: Object.values(messageTypes),
      default: messageTypes.text,
    },
    attachments: [attachmentSchema],

    replyTo: { type: Types.ObjectId, ref: "Message", default: null },

    // ✅ NEW: Message forwarding support
    forwardedFrom: { type: Types.ObjectId, ref: "Message", default: null },
    isForwarded: { type: Boolean, default: false },

    reactions: [{ type: Types.ObjectId, ref: "MessageReaction" }],

    deliveredTo: [deliveredToSchema],
    seenBy: [seenBySchema],

    edited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },

    deleted: { type: Boolean, default: false },
    deletedForEveryone: { type: Boolean, default: false },
    deletedFor: [{ type: Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

// ── Pre-save: auto-set isForwarded ─────────────────────────────
messageSchema.pre("save", function (next) {
  if (this.isNew && this.forwardedFrom) {
    this.isForwarded = true;
  }
  next();
});

// ── Indexes ────────────────────────────────────────────────────
messageSchema.index({ chatRoomId: 1, createdAt: -1 });
messageSchema.index({ chatRoomId: 1, senderId: 1 });
messageSchema.index({ senderId: 1, createdAt: -1 });
messageSchema.index({ chatRoomId: 1, deletedForEveryone: 1, createdAt: -1 });

// Full-text search index on message content
messageSchema.index({ content: "text" });

// Index for unread count queries
messageSchema.index({
  chatRoomId: 1,
  "seenBy.userId": 1,
  senderId: 1,
  createdAt: -1,
});

const messageModel = mongoose.models.Message || model("Message", messageSchema);

export default messageModel;
