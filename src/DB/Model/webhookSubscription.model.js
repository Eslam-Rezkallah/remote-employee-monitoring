import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

/**
 * WebhookSubscription — outbound HTTP delivery for org events.
 *
 * Slack/Linear/Stripe pattern: an org admin registers a URL +
 * subscribes to specific events. Whenever one of those events fires,
 * we POST a signed JSON payload to that URL.
 *
 * Security model:
 *   • Each subscription has its own random `secret`. We sign each
 *     payload with HMAC-SHA256 so the receiver can verify it came
 *     from us. (Same scheme as GitHub webhooks.)
 *   • The `events` array is a whitelist — we never POST event types
 *     the subscription didn't opt into.
 *   • Subscriptions are scoped to a single org; no cross-org leak.
 *
 * Delivery model:
 *   • Fire-and-forget from the event hook (the producer never waits).
 *   • A separate worker (utils/jobs/webhook-delivery.job.js) walks
 *     `webhookDeliveryModel` for retries with exponential backoff.
 */
const webhookSubscriptionSchema = new Schema(
  {
    organizationId: {
      type: Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    createdBy: { type: Types.ObjectId, ref: "User", required: true },

    name: { type: String, required: true, maxlength: 100 },
    targetUrl: { type: String, required: true, maxlength: 2048 },

    // Whitelist. Matches canonical event names (e.g. "task.created",
    // "chat.message.sent", "org.member.join").
    events: { type: [String], default: [] },

    // HMAC signing secret — generated at create time, returned to the
    // user EXACTLY ONCE. Stored as-is (not hashed) because we need it
    // server-side to sign every outgoing payload.
    secret: { type: String, required: true, select: false },

    isActive: { type: Boolean, default: true, index: true },

    // Health tracking — toggled by the delivery worker. After
    // CONSECUTIVE_FAIL_THRESHOLD (default 20) failures we auto-disable
    // the subscription so a dead endpoint doesn't burn retries forever.
    lastDeliveryAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    consecutiveFailures: { type: Number, default: 0 },
    disabledReason: { type: String, default: null },
  },
  { timestamps: true },
);

webhookSubscriptionSchema.index({ organizationId: 1, isActive: 1, events: 1 });

const webhookSubscriptionModel =
  mongoose.models.WebhookSubscription ||
  model("WebhookSubscription", webhookSubscriptionSchema);

export default webhookSubscriptionModel;
