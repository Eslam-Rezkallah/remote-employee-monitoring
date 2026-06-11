import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

/**
 * Per-user notification preferences. One doc per user — created lazily
 * on first read (the API helper handles upsert), so existing users
 * keep working without a backfill migration.
 *
 * Channel matrix:
 *   inApp   = the toast / notification bell (always persisted to DB)
 *   push    = native (FCM/APNs) push
 *   email   = SMTP delivery
 *   muted   = global kill switch — when true, only `inApp` still works
 *
 * Per-type overrides let the user say "I want push for mentions but
 * only in-app for sprint events". Default values are sensible
 * SaaS-style: in-app on, push on, email off (avoid Slack-style
 * inbox spam).
 */

const channelDefaults = {
  inApp: true,
  push: true,
  email: false,
};

const typePrefSchema = new Schema(
  {
    type: { type: String, required: true }, // matches notification.type
    inApp: { type: Boolean, default: channelDefaults.inApp },
    push: { type: Boolean, default: channelDefaults.push },
    email: { type: Boolean, default: channelDefaults.email },
  },
  { _id: false },
);

const notificationPreferenceSchema = new Schema(
  {
    // `unique: true` lives only on the explicit schema.index() below
    // — declaring it here too triggered Mongoose's duplicate-index
    // warning at boot.
    userId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Global defaults applied to every notification type that doesn't
    // have an explicit `byType` entry. Editing here = bulk update for
    // every unset type.
    inApp: { type: Boolean, default: channelDefaults.inApp },
    push: { type: Boolean, default: channelDefaults.push },
    email: { type: Boolean, default: channelDefaults.email },

    // Hard mute — turns off push + email regardless of byType. inApp
    // remains on so the user still sees the bell badge.
    muted: { type: Boolean, default: false },

    // Quiet hours (server timezone). If `mutedFrom` < `mutedTo`,
    // push is suppressed within that window. Email + in-app
    // unaffected — quiet hours are a "don't buzz me" feature.
    quietHoursStart: { type: String, default: null }, // "22:00"
    quietHoursEnd: { type: String, default: null }, // "07:00"
    quietHoursTimezone: { type: String, default: "UTC" }, // IANA

    // Per-type overrides. The lookup helper merges these with the
    // global defaults at evaluation time.
    byType: { type: [typePrefSchema], default: [] },
  },
  { timestamps: true },
);

notificationPreferenceSchema.index({ userId: 1 }, { unique: true });

const notificationPreferenceModel =
  mongoose.models.NotificationPreference ||
  model("NotificationPreference", notificationPreferenceSchema);

export default notificationPreferenceModel;
