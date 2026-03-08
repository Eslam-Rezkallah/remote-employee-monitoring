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
    organization: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
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
    pinnedMessages: [
      {
        type: Types.ObjectId,
        ref: "Message",
      },
    ],
    typingUsers: [
      {
        user: { type: Types.ObjectId, ref: "User" },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  {
    timestamps: true,
  },
);

chatRoomSchema.index({ members: 1 });
chatRoomSchema.index({ organization: 1 });
chatRoomSchema.set("strictPopulate", false);

const chatRoomModel =
  mongoose.models.ChatRoom || model("ChatRoom", chatRoomSchema);

export default chatRoomModel;
