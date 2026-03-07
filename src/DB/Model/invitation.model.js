import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const invitationStatus = {
  Pending: "pending",
  Accepted: "accepted",
  Revoked: "revoked",
  Expired: "expired",
};

const invitationSchema = new Schema(
  {
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["admin", "member"],
      default: "member",
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    invitedBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    acceptedBy: {
      type: Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(invitationStatus),
      default: invitationStatus.Pending,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

invitationSchema.index({ organizationId: 1, email: 1, status: 1 });

const invitationModel =
  mongoose.models.Invitation || model("Invitation", invitationSchema);

export default invitationModel;
