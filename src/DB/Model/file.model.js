import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const fileSchema = new Schema(
  {
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
    },
    key: {
      type: String,
    },
    size: {
      type: Number,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    uploadedBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    relatedTo: {
      type: Types.ObjectId,
      refPath: "relatedModel",
    },
    relatedModel: {
      type: String,
      enum: ["Task", "Message"],
    },
  },
  {
    timestamps: true,
  },
);

fileSchema.index({ uploadedBy: 1, createdAt: -1 });

const fileModel = mongoose.models.File || model("File", fileSchema);

export default fileModel;
