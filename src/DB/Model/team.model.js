import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const teamSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    createdBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [{ type: Types.ObjectId, ref: "User" }],
    managers: [{ type: Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

const teamModel = mongoose.models.Team || model("Team", teamSchema);

export default teamModel;
