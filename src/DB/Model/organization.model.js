import mongoose from "mongoose";

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      // unique: true, // Commented out to avoid duplicate index warning - index created below
      lowercase: true,
      trim: true,
    },
    logo: {
      type: String,
      default: null,
    },
    joinCode: {
      type: String,
      required: true,
      // unique: true, // Commented out to avoid duplicate index warning - index created below
      uppercase: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Soft delete flag
    //Added
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
organizationSchema.index({ slug: 1 }, { unique: true }); // Unique index for slug
organizationSchema.index({ ownerId: 1 });
organizationSchema.index({ joinCode: 1 }, { unique: true }); // Unique index for joinCode

const organizationModel = mongoose.model("Organization", organizationSchema);

export default organizationModel;
