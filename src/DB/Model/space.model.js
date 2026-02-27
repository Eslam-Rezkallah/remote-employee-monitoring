import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const spaceTypes = {
  Project: "Project",
  Team: "Team",
  Personal: "Personal",
};

const spaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    icon: { type: String, default: "" },

    type: {
      type: String,
      enum: Object.values(spaceTypes),
      default: spaceTypes.Project,
    },

    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    createdBy: { type: Types.ObjectId, ref: "User", required: true },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// common filters
spaceSchema.index({ organizationId: 1, type: 1, isDeleted: 1 });
spaceSchema.index({ organizationId: 1, name: 1, isDeleted: 1 });
spaceSchema.index({ name: "text" });

export default mongoose.models.Space || model("Space", spaceSchema);
