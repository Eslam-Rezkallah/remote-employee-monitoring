/**
 * utils/jobs/webhook-delivery.job.js
 *
 * Background worker that drains `webhookDelivery` rows whose
 * `nextAttemptAt` has passed.
 *
 * Backoff:  30s → 2m → 10m → 1h → 6h, then mark dead.
 * Timeout:  10s per HTTP call (configurable).
 *
 * Concurrency: claim-then-process the same way the scheduled-messages
 * job does — atomic `pending → in_flight` flip per row so two workers
 * don't double-deliver.
 *
 * Auto-disable: if a subscription's `consecutiveFailures` crosses
 * the threshold, flip its `isActive = false` and stash the reason.
 * The customer has to manually re-enable.
 */

import webhookSubscriptionModel from "../../DB/Model/webhookSubscription.model.js";
import webhookDeliveryModel, {
  deliveryStatus,
} from "../../DB/Model/webhookDelivery.model.js";
import { signPayload } from "../webhooks/webhook.service.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("webhook-delivery");

const TICK_MS = Number(process.env.WEBHOOK_TICK_MS || 10_000);
const BATCH = Number(process.env.WEBHOOK_BATCH || 30);
const TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS || 10_000);
const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS || 5);
const FAIL_THRESHOLD = Number(
  process.env.WEBHOOK_FAIL_THRESHOLD || 20,
);

const IN_FLIGHT = "in_flight";

// Backoff schedule in ms. Index = attempt number (0-based). After
// MAX_ATTEMPTS we mark the row dead and bump subscription failures.
const BACKOFF_MS = [
  30_000, // 30s
  120_000, // 2m
  600_000, // 10m
  3_600_000, // 1h
  21_600_000, // 6h
];

let _handle = null;

async function claimNext() {
  return webhookDeliveryModel.findOneAndUpdate(
    {
      status: deliveryStatus.Pending,
      nextAttemptAt: { $lte: new Date() },
    },
    { $set: { status: IN_FLIGHT } },
    { sort: { nextAttemptAt: 1 }, new: true },
  );
}

async function deliver(row) {
  // Load the subscription with its secret. `select: false` on the
  // schema means we have to opt in explicitly.
  const sub = await webhookSubscriptionModel
    .findById(row.subscriptionId)
    .select("+secret targetUrl isActive consecutiveFailures");

  if (!sub || !sub.isActive) {
    await webhookDeliveryModel.updateOne(
      { _id: row._id },
      { $set: { status: deliveryStatus.Dead, lastError: "subscription_inactive" } },
    );
    return;
  }

  const body = JSON.stringify(row.payload);
  const signature = signPayload(sub.secret, body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let statusCode = null;
  let errorMsg = null;
  try {
    const res = await fetch(sub.targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-REM-Event": row.event,
        "X-REM-Delivery-Id": String(row._id),
        "X-REM-Signature-256": signature,
        "X-REM-Timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body,
      signal: controller.signal,
    });
    statusCode = res.status;
    // 2xx = success. 3xx redirects we treat as success too (the
    // receiver chose to handle redirection).
    if (res.status >= 200 && res.status < 400) {
      await Promise.all([
        webhookDeliveryModel.updateOne(
          { _id: row._id },
          {
            $set: {
              status: deliveryStatus.Delivered,
              lastStatusCode: statusCode,
              lastError: null,
              deliveredAt: new Date(),
            },
            $inc: { attempts: 1 },
          },
        ),
        webhookSubscriptionModel.updateOne(
          { _id: sub._id },
          {
            $set: {
              consecutiveFailures: 0,
              lastDeliveryAt: new Date(),
              lastSuccessAt: new Date(),
            },
          },
        ),
      ]);
      return;
    }
    errorMsg = `HTTP ${statusCode}`;
  } catch (err) {
    errorMsg = err.name === "AbortError" ? "timeout" : err.message;
  } finally {
    clearTimeout(timer);
  }

  await onFailure(row, sub, statusCode, errorMsg);
}

async function onFailure(row, sub, statusCode, errorMsg) {
  const nextAttempt = row.attempts + 1;

  if (nextAttempt >= MAX_ATTEMPTS) {
    // Give up on this delivery.
    await webhookDeliveryModel.updateOne(
      { _id: row._id },
      {
        $set: {
          status: deliveryStatus.Dead,
          lastStatusCode: statusCode,
          lastError: errorMsg,
        },
        $inc: { attempts: 1 },
      },
    );
  } else {
    // Requeue with backoff.
    const delay = BACKOFF_MS[Math.min(nextAttempt, BACKOFF_MS.length - 1)];
    await webhookDeliveryModel.updateOne(
      { _id: row._id },
      {
        $set: {
          status: deliveryStatus.Pending,
          nextAttemptAt: new Date(Date.now() + delay),
          lastStatusCode: statusCode,
          lastError: errorMsg,
        },
        $inc: { attempts: 1 },
      },
    );
  }

  // Track subscription health. After FAIL_THRESHOLD consecutive
  // failures, auto-disable so a dead URL stops burning retries.
  const updatedSub = await webhookSubscriptionModel.findOneAndUpdate(
    { _id: sub._id },
    {
      $inc: { consecutiveFailures: 1 },
      $set: { lastDeliveryAt: new Date() },
    },
    { new: true },
  );

  if (
    updatedSub &&
    updatedSub.consecutiveFailures >= FAIL_THRESHOLD &&
    updatedSub.isActive
  ) {
    await webhookSubscriptionModel.updateOne(
      { _id: sub._id },
      {
        $set: {
          isActive: false,
          disabledReason: `auto-disabled after ${updatedSub.consecutiveFailures} consecutive failures (last error: ${errorMsg})`,
        },
      },
    );
    log.warn(
      { subscriptionId: String(sub._id), failures: updatedSub.consecutiveFailures },
      "webhook subscription auto-disabled",
    );
  }
}

async function tick() {
  try {
    let processed = 0;
    while (processed < BATCH) {
      const row = await claimNext();
      if (!row) break;
      await deliver(row);
      processed++;
    }
    if (processed > 0) {
      log.debug({ processed }, "webhook batch drained");
    }
  } catch (err) {
    log.error({ err }, "webhook tick failed");
  }
}

export function startWebhookDeliveryJob() {
  if (_handle) return;
  log.info({ intervalMs: TICK_MS, batchSize: BATCH }, "webhook delivery job started");
  _handle = setInterval(tick, TICK_MS);
  if (_handle.unref) _handle.unref();
}

export function stopWebhookDeliveryJob() {
  if (_handle) {
    clearInterval(_handle);
    _handle = null;
  }
}
