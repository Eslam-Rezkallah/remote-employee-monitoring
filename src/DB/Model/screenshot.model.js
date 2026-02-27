import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const screenshotSchema = new Schema(
  {
    session: {
      type: Types.ObjectId,
      ref: "WorkSession",
      required: true,
    },
    imageUrl: {
      type: String,
      required: true, 
    },
    capturedAt: {
      type: Date,
      required: true,
    },

  },
  { timestamps: true }
);

const screenshotModel =
  mongoose.models.Screenshot || model("Screenshot", screenshotSchema);

export default screenshotModel;
