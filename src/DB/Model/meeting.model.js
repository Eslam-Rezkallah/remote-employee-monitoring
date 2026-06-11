import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const meetingStatus = {
  Scheduled: "scheduled",
  Started: "started",
  Ended: "ended",
  Cancelled: "cancelled",
};

/**
 * Meeting — a future scheduled call (Teams "Schedule a meeting").
 *
 * Different from `Call`:
 *   • Call is the live session, created at the moment of dialling.
 *   • Meeting is the calendar entry — title, agenda, invitees, time
 *     range — and points to a future Call doc when it actually fires.
 *
 * Workflow:
 *   1. Organizer creates a Meeting (POST /meetings)
 *   2. Reminder cron pushes "starting in N minutes" notifications
 *   3. At startTime any invitee can join → first joiner spins up a Call
 *      and links `meetingId` on the call doc; subsequent joiners get
 *      the LiveKit token for that Call.
 *   4. When the call ends, the Meeting flips to Ended.
 */
const meetingSchema = new Schema(
  {
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    chatRoomId: {
      // Optional — when present the meeting belongs to a specific
      // channel/group. When null it's an "ad-hoc" meeting and we
      // create a one-off room on first join.
      type: Types.ObjectId,
      ref: "ChatRoom",
      default: null,
    },
    organizerId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    agenda: { type: String, default: "", maxlength: 5000 },

    startTime: { type: Date, required: true, index: true },
    endTime: { type: Date, required: true },

    // RFC 5545-ish recurrence rule string. Optional — null means
    // "one-off". The cron parser only handles a tiny subset
    // (FREQ=DAILY/WEEKLY, COUNT, BYDAY) for now.
    recurrenceRule: { type: String, default: null },

    // Invitees + their RSVP. invitees[].userId is the User; status is
    // their answer. The organizer is implicitly accepted.
    invitees: [
      {
        userId: { type: Types.ObjectId, ref: "User", required: true },
        status: {
          type: String,
          enum: ["pending", "accepted", "declined", "tentative"],
          default: "pending",
        },
        respondedAt: { type: Date, default: null },
        isRequired: { type: Boolean, default: true },
      },
    ],

    // When the meeting fires we wire it to a Call doc. Until then null.
    callId: { type: Types.ObjectId, ref: "Call", default: null },

    status: {
      type: String,
      enum: Object.values(meetingStatus),
      default: meetingStatus.Scheduled,
      index: true,
    },

    // Did we already push the "starting soon" reminder? Set once so
    // the cron doesn't double-notify when ticks overlap.
    reminderSent: { type: Boolean, default: false },

    // Soft delete keeps history queryable after cancellation.
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Cron query: "meetings about to start that haven't been reminded yet"
meetingSchema.index({ status: 1, startTime: 1, reminderSent: 1 });

// "My upcoming meetings" — invitee timeline
meetingSchema.index({ "invitees.userId": 1, status: 1, startTime: 1 });

// "Meetings in this org sorted by start" — org calendar view
meetingSchema.index({ organizationId: 1, startTime: 1, isDeleted: 1 });

const meetingModel =
  mongoose.models.Meeting || model("Meeting", meetingSchema);

export default meetingModel;
