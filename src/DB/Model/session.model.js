import mongoose from "mongoose";
const { Schema, model } = mongoose;

const sessionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    // Device / client info
    userAgent: {
      type: String,
      default: "Unknown",
    },
    ipAddress: {
      type: String,
      default: "Unknown",
    },
    // Status
    isRevoked: {
      type: Boolean,
      default: false,
    },
    // When the refresh token itself expires (absolute expiry)
    expiresAt: {
      type: Date,
      required: true,
    },
    // Last time an access token was refreshed using this session
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Auto-delete expired sessions from MongoDB
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1 });
sessionSchema.index({ refreshToken: 1 });

const sessionModel =
  mongoose.models.Session || model("Session", sessionSchema);

export default sessionModel;
