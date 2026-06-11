/**
 * utils/webhooks/webhook.service.js
 *
 * Producer-side API: any service can call `emitWebhook(orgId, event, data)`
 * to queue an outbound HTTP POST to every active subscription that
 * opted into that event. Delivery happens asynchronously in the worker
 * (utils/jobs/webhook-delivery.job.js).
 *
 * Wire-format (sent to the customer's URL):
 *   POST <subscription.targetUrl>
 *   Headers:
 *     Content-Type:        application/json
 *     X-REM-Event:         <event name, e.g. "task.created">
 *     X-REM-Delivery-Id:   <ObjectId of webhookDelivery row>
 *     X-REM-Signature-256: sha256=<hmac of raw body, using subscription.secret>
 *     X-REM-Timestamp:     <unix seconds at send time — receiver should
 *                           reject if older than ~5 minutes to defeat replay>
 *
 * Receivers verify the signature with HMAC-SHA256 over the raw body
 * using the secret they were shown at subscription-creation time.
 */

import crypto from "node:crypto";
import webhookSubscriptionModel from "../../DB/Model/webhookSubscription.model.js";
import webhookDeliveryModel, {
  deliveryStatus,
} from "../../DB/Model/webhookDelivery.model.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("webhook-producer");

/**
 * Generate a fresh random secret for new subscriptions. 32 bytes is
 * 256 bits of entropy — same as GitHub.
 */
export function generateWebhookSecret() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Compute the signature header value for a payload. Receivers do the
 * same HMAC on their side to verify.
 */
export function signPayload(secret, rawBody) {
  const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return `sha256=${hmac}`;
}

/**
 * Queue a webhook event for delivery. Fire-and-forget — the producer
 * doesn't block on HTTP. Returns the number of subscriptions that
 * were queued (or 0 if no one is subscribed).
 *
 * `data` becomes the JSON `data` field of the payload; the wrapper
 * envelope adds the canonical fields (event, timestamp, organizationId).
 */
export async function emitWebhook(orgId, event, data = {}) {
  if (!orgId || !event) return 0;

  // Find every active subscription that wants this event.
  const subs = await webhookSubscriptionModel
    .find({
      organizationId: orgId,
      isActive: true,
      events: event,
    })
    .select("_id")
    .lean();

  if (subs.length === 0) return 0;

  // Queue one delivery row per (subscription, event). The worker will
  // pick these up on the next tick. The body is captured here so a
  // later replay/retry uses the exact bytes the event was minted with
  // (not a re-fetched value that may have changed).
  const docs = subs.map((s) => ({
    subscriptionId: s._id,
    organizationId: orgId,
    event,
    payload: {
      event,
      organizationId: String(orgId),
      timestamp: new Date().toISOString(),
      data,
    },
    status: deliveryStatus.Pending,
    nextAttemptAt: new Date(),
  }));

  try {
    await webhookDeliveryModel.insertMany(docs, { ordered: false });
    log.debug({ orgId: String(orgId), event, count: subs.length }, "queued webhooks");
    return subs.length;
  } catch (err) {
    log.error({ err, orgId: String(orgId), event }, "queue webhook failed");
    return 0;
  }
}
