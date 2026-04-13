import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const callTypes = {
  VOICE: "voice",
  VIDEO: "video",
};

export const callStatus = {
  RINGING: "ringing",
  ACTIVE: "active",
  ENDED: "ended",
  MISSED: "missed",
  REJECTED: "rejected",
  BUSY: "busy",
  FAILED: "failed",
};

const participantSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: null },
    leftAt: { type: Date, default: null },
    // tracks current state for participants
    isMuted: { type: Boolean, default: false },
    isCameraOff: { type: Boolean, default: true },
    // "ringing" | "in-call" | "left" | "rejected" | "missed"
    state: {
      type: String,
      enum: ["ringing", "in-call", "left", "rejected", "missed"],
      default: "ringing",
    },
  },
  { _id: false },
);

const callSchema = new Schema(
  {
    chatRoomId: {
      type: Types.ObjectId,
      ref: "ChatRoom",
      required: true,
      index: true,
    },
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },

    // who started the call
    callerId: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: Object.values(callTypes),
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(callStatus),
      default: callStatus.RINGING,
      index: true,
    },

    participants: [participantSchema],

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },

    // duration in seconds (computed when call ends)
    durationSeconds: { type: Number, default: 0 },

    // max participants that were in the call simultaneously
    maxParticipants: { type: Number, default: 0 },

    // if the call ended due to an error
    endReason: {
      type: String,
      enum: [
        "normal",
        "missed",
        "rejected",
        "busy",
        "timeout",
        "error",
        "network",
      ],
      default: "normal",
    },
  },
  { timestamps: true },
);

// ── Indexes ────────────────────────────────────────────────────
callSchema.index({ chatRoomId: 1, status: 1 });
callSchema.index({ chatRoomId: 1, createdAt: -1 });
callSchema.index({ callerId: 1, createdAt: -1 });
callSchema.index({ "participants.userId": 1, createdAt: -1 });
callSchema.index({ organizationId: 1, createdAt: -1 });

// Only one active/ringing call per room at a time
callSchema.index(
  { chatRoomId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: [callStatus.RINGING, callStatus.ACTIVE] },
    },
    name: "unique_active_call_per_room",
  },
);

const callModel = mongoose.models.Call || model("Call", callSchema);

export default callModel;
