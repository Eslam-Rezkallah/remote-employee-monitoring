import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const reminderStatus = {
  Pending: "pending",
  Sent: "sent",
  Cancelled: "cancelled",
  Failed: "failed",
};

/**
 * Reminder — a user-scheduled nudge ("/remind me in 30m to ...").
 *
 * Slack's `/remind` returns a private message + push at the trigger
 * time. We mirror that: at `triggerAt`, the cron picks the row up and
 * pushes a notification to `userId` via the standard notification
 * fabric (inApp + push + email per their preferences).
 *
 * Separate from `scheduledMessage` because:
 *   • reminders fire ONE notification to one user, not a chat message
 *   • cancellation rules are different (anyone with the link can mark
 *     `done`, but only the creator can `cancel`)
 *   • the FE shows a "My reminders" list distinct from the timeline
 */
const reminderSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true, index: true },

    // Free-form text. We trim + clamp to keep DB writes bounded.
    text: { type: String, required: true, trim: true, maxlength: 500 },

    triggerAt: { type: Date, required: true, index: true },

    // Optional context — if set, the FE deep-links the notification.
    sourceRoomId: { type: Types.ObjectId, ref: "ChatRoom", default: null },
    sourceMessageId: { type: Types.ObjectId, ref: "Message", default: null },

    status: {
      type: String,
      enum: Object.values(reminderStatus),
      default: reminderStatus.Pending,
      index: true,
    },

    sentAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  { timestamps: true },
);

// Hot query: "find pending reminders due now". Compound on (status, triggerAt).
reminderSchema.index({ status: 1, triggerAt: 1 });
// User-facing list: "show me my upcoming reminders"
reminderSchema.index({ userId: 1, status: 1, triggerAt: 1 });

const reminderModel =
  mongoose.models.Reminder || model("Reminder", reminderSchema);

export default reminderModel;
