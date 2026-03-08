import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const viewTypes = {
  Summary: "summary",
  Timeline: "timeline",
  Backlog: "backlog",
  Sprints: "sprints",
  Calendar: "calendar",
};

const spaceViewSchema = new Schema(
  {
    spaceId: { type: Types.ObjectId, ref: "Space", required: true, index: true },
    organizationId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 50 },
    type: { type: String, enum: Object.values(viewTypes), required: true },

    isDefault: { type: Boolean, default: true },
    config: { type: Schema.Types.Mixed, default: {} },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

spaceViewSchema.index({ spaceId: 1, type: 1 }, { unique: true });

export default mongoose.models.SpaceView || model("SpaceView", spaceViewSchema);
