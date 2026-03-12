import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const projectSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },
    status: {
      type: String,
      enum: ["Active", "Completed", "Archived"],
      default: "Active",
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },

    // ── Scope ─────────────────────────────────────────────────
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    team: {
      type: Types.ObjectId,
      ref: "Team",
      required: true,
    },

    // ── People ────────────────────────────────────────────────
    manager: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],

    // ── Relations ─────────────────────────────────────────────
    tasks: [
      {
        type: Types.ObjectId,
        ref: "Task",
      },
    ],

    // ── Soft delete ───────────────────────────────────────────
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// ── Indexes ───────────────────────────────────────────────────
projectSchema.index({ organizationId: 1, isDeleted: 1 });
projectSchema.index({ organizationId: 1, status: 1, isDeleted: 1 });
projectSchema.index({ team: 1, isDeleted: 1 });
projectSchema.index({ manager: 1, isDeleted: 1 });
projectSchema.index({ members: 1, isDeleted: 1 });
projectSchema.index({ title: "text", description: "text" });

const projectModel =
  mongoose.models.Project || model("Project", projectSchema);

export default projectModel;