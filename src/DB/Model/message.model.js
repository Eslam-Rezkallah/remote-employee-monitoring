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
    size: { type: Number, default: 0 }, // bytes
    duration: { type: Number, default: null }, // seconds (voice/video)
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
    // ── Core ───────────────────────────────────────────────────
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

    // ── Content ────────────────────────────────────────────────
    content: { type: String, default: "", maxlength: 5000, trim: true },
    messageType: {
      type: String,
      enum: Object.values(messageTypes),
      default: messageTypes.text,
    },
    attachments: [attachmentSchema],

    // ── Threading ──────────────────────────────────────────────
    replyTo: { type: Types.ObjectId, ref: "Message", default: null },

    // ── Reactions (references to MessageReaction documents) ────
    reactions: [{ type: Types.ObjectId, ref: "MessageReaction" }],

    // ── Delivery & Read receipts ───────────────────────────────
    deliveredTo: [deliveredToSchema],
    seenBy: [seenBySchema],

    // ── Edit tracking ──────────────────────────────────────────
    edited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },

    // ── Delete tracking ────────────────────────────────────────
    deleted: { type: Boolean, default: false },
    deletedForEveryone: { type: Boolean, default: false },
    deletedFor: [{ type: Types.ObjectId, ref: "User" }], // "delete for me"
  },
  { timestamps: true },
);

// ── Indexes ────────────────────────────────────────────────────
messageSchema.index({ chatRoomId: 1, createdAt: -1 });
messageSchema.index({ chatRoomId: 1, senderId: 1 });
messageSchema.index({ senderId: 1, createdAt: -1 });
messageSchema.index({ chatRoomId: 1, deletedForEveryone: 1, createdAt: -1 });

const messageModel = mongoose.models.Message || model("Message", messageSchema);

export default messageModel;
