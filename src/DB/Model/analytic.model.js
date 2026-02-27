import mongoose, { Schema, model, Types } from "mongoose";
const analyticsSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    period: { type: String }, // e.g. "2026-01"
    productivityScore: Number,
    clusterLabel: String, // e.g. "High Performer", "Burnout Risk"
    activeHours: Number,
    idlePercentage: Number,
    topApps: [String],
    anomalies: [String],
  },
  { timestamps: true }
);

const Analytics =
  mongoose.models.Analytics || model("Analytics", analyticsSchema);

export default Analytics;