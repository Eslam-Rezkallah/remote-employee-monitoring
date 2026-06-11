import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const activityEventTypes = {
  Keystroke: "keystroke",
  Mouse: "mouse",
  AppUsage: "app_usage",
  WebsiteVisit: "website_visit",
};

/**
 * ActivityEvent — granular per-second-ish telemetry uploaded by the
 * desktop agent.
 *
 * Volume warning: at 1 event/sec for 8 hours = 28.8k rows per user per
 * day. We store ROLLED-UP counters, not raw events:
 *   • keystroke / mouse → per-minute aggregates (count of strokes/moves)
 *   • app_usage         → "user was in <app> from T1 to T2"
 *   • website_visit     → same shape as app_usage with `domain`
 *
 * The agent batches uploads (every 60s typically) so the BE just
 * inserts. We use insertMany with `ordered: false` so a single bad
 * row in a batch doesn't drop the rest.
 *
 * Retention: a separate cron (NOT implemented yet) should age out rows
 * older than 90 days to a cold archive. For now they accumulate.
 */
const activityEventSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "User", required: true },
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    sessionId: { type: Types.ObjectId, ref: "WorkSession", default: null },

    type: {
      type: String,
      enum: Object.values(activityEventTypes),
      required: true,
    },

    // The minute-bucket this row covers (rounded down). Aggregates
    // for app_usage / website_visit carry their full [startTime, endTime]
    // separately for accurate reports.
    bucketAt: { type: Date, required: true },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },

    // Type-specific payload.
    //   keystroke      → { count: number }
    //   mouse          → { clicks: number, scrolls: number, distance: number }
    //   app_usage      → { appName: string, windowTitle: string }
    //   website_visit  → { domain: string, url: string, productive: bool|null }
    payload: { type: Schema.Types.Mixed, default: {} },

    // Captured by the agent so the analytics layer can group by client.
    clientPlatform: { type: String, default: null }, // win/mac/linux
    agentVersion: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }, // append-only
);

// Per-user + per-time queries (the main report shape)
activityEventSchema.index({ userId: 1, bucketAt: -1 });
// Per-org admin dashboards
activityEventSchema.index({ organizationId: 1, bucketAt: -1 });
// Per-type filters (e.g., "show me all website visits today")
activityEventSchema.index({ userId: 1, type: 1, bucketAt: -1 });

const activityEventModel =
  mongoose.models.ActivityEvent ||
  model("ActivityEvent", activityEventSchema);

export default activityEventModel;
