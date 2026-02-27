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
  },

  {
    timestamps: true,
  }
);


messageSchema.index({ chatRoom: 1, createdAt: 1 });

const messageModel = mongoose.models.Message || model("Message", messageSchema);

export default messageModel;
