import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const chatRoomSchema = new Schema(
  {
    name: {
      type: String,
      trim: true,
    },
    type: {
      type: String,
      enum: ["private", "group", "project"],
      required: true,
    },
    project: {
      type: Types.ObjectId,
      ref: "Project",
    },
    members: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],
    lastMessage: {
      type: Types.ObjectId,
      ref: "Message",
    },
    unreadCounts: [
      {
        user: { type: Types.ObjectId, ref: "User" },
        count: { type: Number, default: 0 },
      },
    ],
    // New field for pinned messages
    pinnedMessages: [{ type: Types.ObjectId, ref: "Message" }],
  },
  {
    timestamps: true,
  },
);

chatRoomSchema.index({ members: 1 });

const chatRoomModel =
  mongoose.models.ChatRoom || model("ChatRoom", chatRoomSchema);

export default chatRoomModel;
