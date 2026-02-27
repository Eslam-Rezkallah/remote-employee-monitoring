import mongoose, { Schema, model, Types } from "mongoose";
const notificationSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["task_assigned", "mention", "message", "daily_summary"],
    },
    content: String,
    relatedId: Types.ObjectId, // task/message id
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const Notification =
  mongoose.models.Notification || model("Notification", notificationSchema);

export default Notification;