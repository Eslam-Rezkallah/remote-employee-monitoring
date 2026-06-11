import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;
import { ActivityEntityTypes } from "./constants/entityTypes.js";


export const activityActions = {
  Create: "create",
  Update: "update",
  Delete: "delete",
  StatusChange: "status_change",
  Assign: "assign",
  Unassign: "unassign",
  Comment: "comment",
  Star: "star",
  Unstar: "unstar",
  Pin: "pin",
  Unpin: "unpin",
};

const recentActivitySchema = new Schema(
  {
    actorId: { type: Types.ObjectId, ref: "User", required: true, index: true },

    orgId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    spaceId: { type: Types.ObjectId, ref: "Space", default: null, index: true },

    entityType: {
      type: String,
      enum: Object.values(ActivityEntityTypes),
      required: true,
      index: true,
    },
    entityId: { type: Types.ObjectId, required: true, index: true },

    action: {
      type: String,
      enum: Object.values(activityActions),
      required: true,
      index: true,
    },

    meta: { type: Schema.Types.Mixed, default: {} },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

// =========================
// Indexes (Performance / Phase 9)
// =========================

// Main feed: org timeline (fast sort by newest)
recentActivitySchema.index({ orgId: 1, isDeleted: 1, createdAt: -1 });

// Filtered feed: org + space timeline
recentActivitySchema.index({ orgId: 1, spaceId: 1, isDeleted: 1, createdAt: -1 });

// “My activity” pages / audit
recentActivitySchema.index({ actorId: 1, isDeleted: 1, createdAt: -1 });

// Drilldown: show activity for a specific entity
recentActivitySchema.index({ orgId: 1, entityType: 1, entityId: 1, createdAt: -1 });

// Optional: action filtering (if you ever use ?action=)
recentActivitySchema.index({ orgId: 1, action: 1, createdAt: -1 });

export default mongoose.models.RecentActivity || model("RecentActivity", recentActivitySchema);
