import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const teamSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    createdBy: {
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
    managers: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],
    // Soft delete — consistent with the rest of your codebase
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
teamSchema.index({ createdBy: 1, isDeleted: 1 });        // teams created by a user
teamSchema.index({ members: 1, isDeleted: 1 });          // teams a user belongs to
teamSchema.index({ managers: 1, isDeleted: 1 });         // teams a user manages
teamSchema.index({ name: "text" });                      // full-text search by name

const teamModel = mongoose.models.Team || model("Team", teamSchema);

export default teamModel;