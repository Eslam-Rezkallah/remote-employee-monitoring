import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const starredEntityTypes = {
  Task: "Task",
  Space: "Space",
  Sprint: "Sprint",
};

const starredItemSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },
    orgId: { type: Types.ObjectId, ref: "Organization", required: true, index: true },
    entityType: { type: String, enum: Object.values(starredEntityTypes), required: true },
    entityId: { type: Types.ObjectId, required: true },
  },
  { timestamps: true }
);

starredItemSchema.index(
  { userId: 1, entityType: 1, entityId: 1 },
  { unique: true }
);

export default mongoose.models.StarredItem || model("StarredItem", starredItemSchema);
