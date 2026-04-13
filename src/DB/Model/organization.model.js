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
      uppercase: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// ── Indexes ───────────────────────────────────────────────────
// FIX: partialFilterExpression ensures deleted orgs don't block
//      new orgs from using the same name/slug/joinCode.
organizationSchema.index(
  { name: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: "unique_name_active",
  },
);

organizationSchema.index(
  { slug: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: "unique_slug_active",
  },
);

organizationSchema.index(
  { joinCode: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
    name: "unique_joincode_active",
  },
);

organizationSchema.index({ ownerId: 1 });

const organizationModel = mongoose.model("Organization", organizationSchema);

export default organizationModel;
