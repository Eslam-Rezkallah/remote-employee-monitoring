import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const SESSION_STATUS = Object.freeze({
  ACTIVE:  "active",
  PAUSED:  "paused",
  STOPPED: "stopped",
});

// alias kept for any other file that already uses SessionStatus
export const SessionStatus = SESSION_STATUS;

export const ActivityType = Object.freeze({
  KEYBOARD:   "keyboard",
  MOUSE:      "mouse",
  APP_SWITCH: "app_switch",
});

export const IDLE_THRESHOLD_SECONDS = 60;

const pauseSegmentSchema = new Schema(
  {
    pausedAt:  { type: Date, required: true },
    resumedAt: { type: Date, default: null },
  },
  { _id: false }
);

const activityLogSchema = new Schema(
  {
    timestamp: { type: Date, required: true },
    type: {
      type: String,
      enum: Object.values(ActivityType),
      required: true,
    },
    details: { type: String, default: "" },
  },
  { _id: false }
);

const workSessionSchema = new Schema(
  {
    userId: {
      type:     Types.ObjectId,
      ref:      "User",
      required: true,
      index:    true,
    },
    taskId: {
      type:    Types.ObjectId,
      ref:     "Task",
      default: null,
      index:   true,
    },
    organizationId: {
      type:     Types.ObjectId,
      ref:      "Organization",
      required: true,
      index:    true,
    },

    status: {
      type:    String,
      enum:    Object.values(SESSION_STATUS),
      default: SESSION_STATUS.ACTIVE,
      index:   true,
    },

    startTime: { type: Date, required: true },
    endTime:   { type: Date, default: null },

    activeSeconds:  { type: Number, default: 0, min: 0 },
    idleSeconds:    { type: Number, default: 0, min: 0 },
    pausedSeconds:  { type: Number, default: 0, min: 0 },

    pauseSegments:   { type: [pauseSegmentSchema], default: [] },

    lastActivityAt:  { type: Date, default: null },
    lastHeartbeatAt: { type: Date, default: null },

    idleWindowStart: { type: Date, default: null },
    isIdle:          { type: Boolean, default: false },

    activityLogs: { type: [activityLogSchema], default: [] },

    isAbandoned: { type: Boolean, default: false },
    abandonedAt: { type: Date,    default: null },
    recoveredAt: { type: Date,    default: null },

    note: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true }
);

/* ─── Compound indexes ──────────────────────────────────────── */

workSessionSchema.index(
  { userId: 1, status: 1 },
  {
    unique:                  true,
    partialFilterExpression: { status: SESSION_STATUS.ACTIVE },
    name:                    "unique_active_session_per_user",
  }
);

workSessionSchema.index({ organizationId: 1, startTime: -1 });
workSessionSchema.index({ userId: 1, startTime: -1 });
workSessionSchema.index({ taskId: 1, startTime: -1 });
workSessionSchema.index({ status: 1, lastActivityAt: 1 });
workSessionSchema.index({ status: 1, lastHeartbeatAt: 1 });

/* ─── Virtual: totalWallSeconds ─────────────────────────────── */
workSessionSchema.virtual("totalWallSeconds").get(function () {
  const end    = this.endTime || new Date();
  const wallMs = end - this.startTime;

  const pausedMs = this.pauseSegments.reduce((acc, seg) => {
    const resumedAt = seg.resumedAt || new Date();
    return acc + (resumedAt - seg.pausedAt);
  }, 0);

  return Math.max(0, Math.floor((wallMs - pausedMs) / 1000));
});

/* ─── Virtual: currentPausedSeconds ─────────────────────────── */
workSessionSchema.virtual("currentPausedSeconds").get(function () {
  const pausedMs = this.pauseSegments.reduce((acc, seg) => {
    const resumedAt = seg.resumedAt || new Date();
    return acc + (resumedAt - seg.pausedAt);
  }, 0);
  return Math.floor(pausedMs / 1000);
});

workSessionSchema.set("toJSON",   { virtuals: true });
workSessionSchema.set("toObject", { virtuals: true });

/* ─── Instance method: computeTotals ────────────────────────────
   Called before every save (pause / resume / stop).
   Calculates pausedSeconds from pauseSegments, then derives
   activeSeconds = nonPausedSeconds - idleSeconds.
──────────────────────────────────────────────────────────────── */
workSessionSchema.methods.computeTotals = function () {
  // 1. Sum all pause segments (closed + still-open)
  let pausedMs = 0;
  for (const seg of this.pauseSegments) {
    const end = seg.resumedAt || new Date(); // still paused = count until now
    pausedMs += end - seg.pausedAt;
  }
  this.pausedSeconds = Math.floor(pausedMs / 1000);

  // 2. Wall-clock elapsed since session start
  const wallClock = Math.floor(
    ((this.endTime || new Date()) - this.startTime) / 1000
  );

  // 3. Non-paused = wall-clock minus explicit pauses
  const nonPaused = Math.max(0, wallClock - this.pausedSeconds);

  // 4. Active = non-paused minus idle (floor at 0)
  this.activeSeconds = Math.max(0, nonPaused - this.idleSeconds);
};

/* ─── Model ─────────────────────────────────────────────────── */
const workSessionModel =
  mongoose.models.WorkSession || model("WorkSession", workSessionSchema);

export default workSessionModel;