import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const workSessionSchema = new Schema(
  {
    user: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    task: { type: Types.ObjectId, ref: "Task" },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: Date,
    totalActiveSeconds: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    screenshots: [{ type: Types.ObjectId, ref: "Screenshot" }],
    
    activityLogs: [
      {
        timestamp: Date,
        type: { type: String, enum: ["keyboard", "mouse", "app_switch"] },
        details: String, 
      },
    ],
  },
  { timestamps: true }
);

const workSessionModel =
  mongoose.models.WorkSession || model("WorkSession", workSessionSchema);

export default workSessionModel;
