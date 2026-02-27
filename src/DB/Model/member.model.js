import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const memberRoles = {
  Owner: "owner",
  Admin: "admin",
  Member: "member",
};

const memberSchema = new Schema(
  {
    // =========================
    // Relations
    // =========================
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // =========================
    // RBAC
    // =========================
    role: {
      type: String,
      enum: Object.values(memberRoles),
      default: memberRoles.Member,
      index: true,
    },

    // =========================
    // State
    // =========================
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// =========================
// Indexes (Phase 9)
// =========================

// 1️⃣ Ensure one membership per org per user
memberSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

// 2️⃣ Fast permission checks (used everywhere)
memberSchema.index({
  organizationId: 1,
  userId: 1,
  isActive: 1,
});

// 3️⃣ Admin/Owner checks
memberSchema.index({
  organizationId: 1,
  role: 1,
  isActive: 1,
});

// 4️⃣ List all org members
memberSchema.index({
  organizationId: 1,
  isActive: 1,
  joinedAt: -1,
});

// 5️⃣ List all orgs for a user
memberSchema.index({
  userId: 1,
  isActive: 1,
});

const memberModel = mongoose.models.Member || model("Member", memberSchema);
export default memberModel;
