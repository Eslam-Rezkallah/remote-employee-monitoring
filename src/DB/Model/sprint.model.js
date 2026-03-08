import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const sprintStatus = {
  Planned: "Planned",
  Active: "Active",
  Closed: "Closed",
};

const sprintSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    goal: { type: String, default: "" },

    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    spaceId: {
      type: Types.ObjectId,
      ref: "Space",
      required: true,
      index: true,
    },

    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    status: {
      type: String,
      enum: Object.values(sprintStatus),
      default: sprintStatus.Planned,
      index: true,
    },

    createdBy: { type: Types.ObjectId, ref: "User", required: true },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// =========================
// Indexes (Performance / Phase 9)
// =========================

// Active sprint queries (your createSprint/updateSprintStatus rules)
sprintSchema.index({ organizationId: 1, spaceId: 1, status: 1, isDeleted: 1 });

// Velocity (Phase 8.4): list last N sprints by endDate desc
sprintSchema.index({ organizationId: 1, spaceId: 1, endDate: -1, isDeleted: 1 });

// Timeline / planning views
sprintSchema.index({ organizationId: 1, spaceId: 1, startDate: 1, endDate: 1, isDeleted: 1 });

// If you still use these older ones, they're fine (but now covered above)
// sprintSchema.index({ spaceId: 1, status: 1, isDeleted: 1 });
// sprintSchema.index({ spaceId: 1, startDate: 1, endDate: 1, isDeleted: 1 });

export default mongoose.models.Sprint || model("Sprint", sprintSchema);
