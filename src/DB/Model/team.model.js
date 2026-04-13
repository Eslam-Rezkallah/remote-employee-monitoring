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
    // FIX: added organizationId — teams must belong to an org
    //      Without this, teams floated globally and broke org-scoped
    //      permission checks for chat rooms and projects.
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
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
teamSchema.index({ organizationId: 1, isDeleted: 1 }); // all teams in an org
teamSchema.index({ createdBy: 1, isDeleted: 1 }); // teams created by a user
teamSchema.index({ members: 1, isDeleted: 1 }); // teams a user belongs to
teamSchema.index({ managers: 1, isDeleted: 1 }); // teams a user manages
teamSchema.index({ organizationId: 1, name: "text" }); // search by name within org

const teamModel = mongoose.models.Team || model("Team", teamSchema);

export default teamModel;
