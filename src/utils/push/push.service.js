/**
 * utils/push/push.service.js
 *
 * Provider-agnostic push notification facade.
 *
 * Implementation status (v1): scaffolding only.
 *   • Maintains the device-token registry (the source of truth for
 *     who can be reached on what device).
 *   • Exposes `sendPushToUsers(userIds, payload)` that LOOKS UP the
 *     active tokens and (today) just logs them.
 *   • Wired into the notification.event bus as a second transport so
 *     every in-app notification also queues a push attempt.
 *
 * Going from scaffolding → real:
 *   • Plug in firebase-admin (already in dependencies) for FCM/APNs.
 *     The send step in _dispatch() is the single place to wire it up.
 *   • Web push needs `web-push` lib + VAPID keys in env; same hook.
 *   • Mark dead tokens inactive on provider 404/410 responses inside
 *     _dispatch() so the registry self-cleans.
 */

import deviceTokenModel, {
  devicePlatforms,
} from "../../DB/Model/deviceToken.model.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("push");

// ─── Firebase Admin (lazy + optional) ──────────────────────────
// Loaded on first send. If FIREBASE_SERVICE_ACCOUNT_JSON is not set,
// we never try to import / init it — the project keeps booting and the
// dispatch falls back to logging-only mode. This matches the LiveKit
// pattern (feature disabled when creds are missing, never crashes).
let _firebaseMessaging = null;
let _firebaseLoadAttempted = false;

async function getFirebaseMessaging() {
  if (_firebaseMessaging) return _firebaseMessaging;
  if (_firebaseLoadAttempted) return null;
  _firebaseLoadAttempted = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    log.info("FIREBASE_SERVICE_ACCOUNT_JSON not set — push runs in stub mode");
    return null;
  }

  try {
    const { default: admin } = await import("firebase-admin");
    if (!admin.apps.length) {
      const credential = admin.credential.cert(JSON.parse(raw));
      admin.initializeApp({ credential });
      log.info("firebase-admin initialised");
    }
    _firebaseMessaging = admin.messaging();
    return _firebaseMessaging;
  } catch (err) {
    log.error({ err }, "firebase-admin init failed — falling back to stub");
    return null;
  }
}

/**
 * Register or refresh a device token for the current user. Idempotent:
 * re-registering the same token bumps lastSeenAt and clears errors.
 */
export async function registerDevice({ userId, token, platform, label = null }) {
  if (!Object.values(devicePlatforms).includes(platform)) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return deviceTokenModel.findOneAndUpdate(
    { userId, token },
    {
      $set: {
        platform,
        label,
        isActive: true,
        lastSeenAt: new Date(),
        lastErrorAt: null,
        lastErrorReason: null,
      },
      $setOnInsert: { userId, token },
    },
    { upsert: true, new: true },
  );
}

/** Remove (or soft-deactivate) a token — e.g., on logout. */
export async function unregisterDevice({ userId, token }) {
  await deviceTokenModel.updateOne(
    { userId, token },
    { $set: { isActive: false } },
  );
}

/** List the calling user's active devices (for a "Manage devices" UI). */
export async function listDevices({ userId }) {
  return deviceTokenModel
    .find({ userId, isActive: true })
    .select("token platform label lastSeenAt createdAt")
    .sort({ lastSeenAt: -1 })
    .lean();
}

/**
 * Send a push to every active device of every userId.
 *
 *   payload = { title, body, data? }
 *
 * Returns { attempted, sent, failed } — `sent` and `failed` will both
 * be zero in the current stub implementation. Caller MUST NOT rely on
 * delivery; pushes are best-effort. The DB-backed in-app notification
 * remains the authoritative record.
 */
export async function sendPushToUsers(userIds, payload) {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { attempted: 0, sent: 0, failed: 0 };
  }

  const tokens = await deviceTokenModel
    .find({ userId: { $in: userIds }, isActive: true })
    .select("userId token platform")
    .lean();

  if (tokens.length === 0) {
    return { attempted: 0, sent: 0, failed: 0 };
  }

  // Real-world dispatch goes here. For now we just log — having the
  // hook in place means the day we wire FCM/APNs, every existing
  // notification flow starts delivering pushes without app changes.
  return _dispatch(tokens, payload);
}

async function _dispatch(tokens, payload) {
  const messaging = await getFirebaseMessaging();

  if (!messaging) {
    log.info(
      {
        attempted: tokens.length,
        title: payload?.title,
        platforms: countByPlatform(tokens),
      },
      "push dispatch (stub) — no firebase credentials configured",
    );
    return { attempted: tokens.length, sent: 0, failed: 0, stub: true };
  }

  // FCM accepts both iOS and Android device tokens; web push tokens go
  // through the same multicast API in v9+. We split by platform only
  // because web tokens (subscription JSON) need a different code path.
  const fcmTokens = tokens
    .filter((t) =>
      [devicePlatforms.Ios, devicePlatforms.Android].includes(t.platform),
    )
    .map((t) => t.token);

  // Web push not wired yet — log how many we skipped so dashboards
  // can show coverage gaps. Add the web-push lib later if needed.
  const webCount = tokens.filter((t) => t.platform === devicePlatforms.Web)
    .length;
  if (webCount > 0) {
    log.debug({ webCount }, "web push tokens skipped (not wired)");
  }

  if (fcmTokens.length === 0) {
    return { attempted: tokens.length, sent: 0, failed: 0 };
  }

  const message = {
    notification: {
      title: payload?.title || "Notification",
      body: payload?.body || "",
    },
    // Custom data payload — FCM requires all values to be strings.
    data: stringifyValues(payload?.data || {}),
    tokens: fcmTokens,
  };

  try {
    const response = await messaging.sendEachForMulticast(message);
    const failed = [];
    response.responses.forEach((r, i) => {
      if (!r.success) {
        failed.push({ token: fcmTokens[i], error: r.error?.code });
      }
    });

    // Self-cleaning: deactivate tokens the provider rejected as dead.
    // Codes per FCM docs:
    //   messaging/registration-token-not-registered
    //   messaging/invalid-registration-token
    const deadCodes = new Set([
      "messaging/registration-token-not-registered",
      "messaging/invalid-registration-token",
      "messaging/invalid-argument",
    ]);
    const deadTokens = failed
      .filter((f) => deadCodes.has(f.error))
      .map((f) => f.token);

    if (deadTokens.length > 0) {
      await deviceTokenModel.updateMany(
        { token: { $in: deadTokens } },
        {
          $set: {
            isActive: false,
            lastErrorAt: new Date(),
            lastErrorReason: "provider_rejected",
          },
        },
      );
      log.info(
        { count: deadTokens.length },
        "deactivated dead push tokens",
      );
    }

    return {
      attempted: tokens.length,
      sent: response.successCount,
      failed: response.failureCount,
    };
  } catch (err) {
    log.error({ err }, "push dispatch failed");
    return {
      attempted: tokens.length,
      sent: 0,
      failed: tokens.length,
      error: err.message,
    };
  }
}

function countByPlatform(tokens) {
  const out = {};
  for (const t of tokens) out[t.platform] = (out[t.platform] || 0) + 1;
  return out;
}

function stringifyValues(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}
