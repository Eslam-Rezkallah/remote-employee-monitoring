import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

const refreshTokenSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    userAgent: { type: String, default: null },
    ipAddress: { type: String, default: null },
  },
  { timestamps: true },
);

// Auto-delete expired tokens after 7 days past expiry
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 604800 });

// Fast lookup for active tokens
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });

const refreshTokenModel =
  mongoose.models.RefreshToken || model("RefreshToken", refreshTokenSchema);

export default refreshTokenModel;
