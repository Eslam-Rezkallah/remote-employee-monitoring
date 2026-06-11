import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

export const deliveryStatus = {
  Pending: "pending",
  Delivered: "delivered",
  Failed: "failed",
  Dead: "dead", // gave up after MAX_ATTEMPTS
};

/**
 * WebhookDelivery — per-event delivery attempt log.
 *
 * Acts as both a queue (worker picks rows where status=pending and
 * nextAttemptAt <= now) and an audit record (kept for ~30 days even
 * after success so support can answer "did you ever try to call us?").
 *
 * Backoff schedule: 30s, 2m, 10m, 1h, 6h. Configurable in the worker.
 */
const webhookDeliverySchema = new Schema(
  {
    subscriptionId: {
      type: Types.ObjectId,
      ref: "WebhookSubscription",
      required: true,
      index: true,
    },
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },

    event: { type: String, required: true },
    // The actual JSON we POSTed. Stored so support can replay it.
    payload: { type: Schema.Types.Mixed, required: true },

    status: {
      type: String,
      enum: Object.values(deliveryStatus),
      default: deliveryStatus.Pending,
      index: true,
    },

    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },

    // Last response captured — useful for debugging
    lastStatusCode: { type: Number, default: null },
    lastError: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Worker hot query — find pending rows whose retry window opened
webhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

const webhookDeliveryModel =
  mongoose.models.WebhookDelivery ||
  model("WebhookDelivery", webhookDeliverySchema);

export default webhookDeliveryModel;
