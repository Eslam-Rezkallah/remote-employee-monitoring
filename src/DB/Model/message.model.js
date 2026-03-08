import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const messageSchema = new Schema(
  {
    content: {
      type: String,
      required: true,
      trim: true,
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
    attachments: [{ type: Types.ObjectId, ref: "File" }],
    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },
    seenBy: [
      {
        user: { type: Types.ObjectId, ref: "User" },
        seenAt: { type: Date },
      },
    ],
    replyTo: {
      type: Types.ObjectId,
      ref: "Message",
    },
    mentions: [{ type: Types.ObjectId, ref: "User" }],
    reactions: [
      {
        emoji: String,
        users: [{ type: Types.ObjectId, ref: "User" }],
      },
    ],
    pinned: {
      type: Boolean,
      default: false,
    },
    editedAt: Date,
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index({ chatRoom: 1, createdAt: 1 });
messageSchema.set("strictPopulate", false);

const messageModel = mongoose.models.Message || model("Message", messageSchema);

export default messageModel;
