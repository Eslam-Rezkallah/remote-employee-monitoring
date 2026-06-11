import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const scheduledMessageStatus = {
  Pending: "pending",
  // Internal — the cron flips pending→processing atomically before
  // sending, so a stuck row is recoverable and concurrent ticks/
  // instances don't double-send.
  Processing: "processing",
  Sent: "sent",
  Failed: "failed",
  Cancelled: "cancelled",
};

/**
 * ScheduledMessage — payloads queued to be sent at a future time.
 *
 * Stored in a separate collection (NOT on `messages`) so:
 *   • the regular message timeline isn't polluted with un-sent rows
 *   • the cron query is a tight index scan on (status, sendAt)
 *   • cancellation is a simple delete, not a soft-delete state flip
 *
 * On send, the cron promotes the payload into a real Message via the
 * shared message service, then marks this row as `sent` (we keep the
 * row for ~30 days as an audit trail before a cleanup job removes it).
 */
const scheduledMessageSchema = new Schema(
  {
    chatRoomId: {
      type: Types.ObjectId,
      ref: "ChatRoom",
      required: true,
      index: true,
    },
    senderId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Payload — same shape as Message inputs to the shared service.
    content: { type: String, default: "", maxlength: 5000, trim: true },
    messageType: { type: String, default: "text" },
    replyTo: { type: Types.ObjectId, ref: "Message", default: null },
    // (attachments not supported in v1 — we'd need to keep the
    // uploaded files alive across the scheduling window; revisit
    // once we have an asset GC story.)

    sendAt: { type: Date, required: true, index: true },

    status: {
      type: String,
      enum: Object.values(scheduledMessageStatus),
      default: scheduledMessageStatus.Pending,
      index: true,
    },

    // Populated after a successful send so the user can find the
    // resulting message in the timeline.
    deliveredMessageId: {
      type: Types.ObjectId,
      ref: "Message",
      default: null,
    },

    failureReason: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Cron's hot query: "find me the next batch of pending messages
// whose sendAt has passed". This compound index serves it directly.
scheduledMessageSchema.index({ status: 1, sendAt: 1 });

// "List my pending scheduled messages in a room"
scheduledMessageSchema.index({
  senderId: 1,
  chatRoomId: 1,
  status: 1,
  sendAt: 1,
});

const scheduledMessageModel =
  mongoose.models.ScheduledMessage ||
  model("ScheduledMessage", scheduledMessageSchema);

export default scheduledMessageModel;
