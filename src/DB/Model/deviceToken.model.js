import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const devicePlatforms = {
  Web: "web", // browser push (VAPID)
  Ios: "ios", // APNs
  Android: "android", // FCM
};

/**
 * DeviceToken — push registration handle for a user device.
 *
 * One row per (user, token). The same user across multiple devices
 * gets multiple rows; the fan-out service pushes to all active rows.
 *
 * `lastSeenAt` lets us prune dead tokens — if a device hasn't checked
 * in for >90 days, it's almost certainly uninstalled or logged out,
 * and the upstream provider (FCM/APNs) will start returning errors
 * anyway. The push service marks tokens inactive on provider 404/410
 * responses so we don't keep hammering dead endpoints.
 */
const deviceTokenSchema = new Schema(
  {
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Opaque device handle. For FCM/APNs this is the registration token;
    // for web push it's the JSON-stringified subscription object.
    token: { type: String, required: true },
    platform: {
      type: String,
      enum: Object.values(devicePlatforms),
      required: true,
    },

    // User-readable label set by the client (e.g., "Maitha's iPhone").
    label: { type: String, default: null, maxlength: 100 },

    isActive: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, default: Date.now },
    // Filled when the upstream provider rejects this token so a worker
    // can investigate / metrics can alert.
    lastErrorAt: { type: Date, default: null },
    lastErrorReason: { type: String, default: null },
  },
  { timestamps: true },
);

// Idempotent registration — a device that re-sends its token gets
// updated, not duplicated.
deviceTokenSchema.index({ userId: 1, token: 1 }, { unique: true });

// Fan-out query: "all active tokens for users U1..Un"
deviceTokenSchema.index({ userId: 1, isActive: 1 });

const deviceTokenModel =
  mongoose.models.DeviceToken || model("DeviceToken", deviceTokenSchema);

export default deviceTokenModel;
