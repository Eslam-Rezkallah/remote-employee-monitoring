import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const messageSchema = new Schema(
  {
    content: {
      type: String,
      trim: true,
      default: "",
    },
    chatRoom: {
      type: Types.ObjectId,
      ref: "ChatRoom",
      required: true,
    },
    sender: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },

    // File attachments (images, docs, audio, video)
    attachments: [{ type: Types.ObjectId, ref: "File" }],

    // Delivery status
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },

    // Reply to another message
    replyTo: {
      type: Types.ObjectId,
      ref: "Message",
    },

    // Thread replies (parent message holds refs to its thread replies)
    threadReplies: [{ type: Types.ObjectId, ref: "Message" }],

    // Whether this message is a thread reply itself
    isThreadReply: {
      type: Boolean,
      default: false,
    },

    // @mentions
    mentions: [{ type: Types.ObjectId, ref: "User" }],

    // Emoji reactions
    reactions: [
      {
        emoji: { type: String, required: true },
        users: [{ type: Types.ObjectId, ref: "User" }],
      },
    ],

    // Edit tracking
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: Date,

    // Pin tracking
    isPinned: {
      type: Boolean,
      default: false,
    },
    pinnedBy: {
      type: Types.ObjectId,
      ref: "User",
    },
    pinnedAt: Date,

    // Voice message flag
    isVoice: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for performance
messageSchema.index({ chatRoom: 1, createdAt: 1 });
messageSchema.index({ chatRoom: 1, isPinned: 1 });
messageSchema.index({ chatRoom: 1, content: "text" }); // text search index

const messageModel = mongoose.models.Message || model("Message", messageSchema);

export default messageModel;
