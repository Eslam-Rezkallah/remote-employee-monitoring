import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const projectSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: String,
    status: {
      type: String,
      enum: ["Active", "Completed", "Archived"],
      default: "Active",
    },
    startDate: Date,
    endDate: Date,
    team: {
      type: Types.ObjectId,
      ref: "Team",
      required: true,
    },
    manager: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [{ type: Types.ObjectId, ref: "User" }],
    tasks: [{ type: Types.ObjectId, ref: "Task" }],
  },
  { timestamps: true }
);

const projectModel = mongoose.models.Project || model("Project", projectSchema);

export default projectModel;
