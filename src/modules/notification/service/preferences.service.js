/**
 * modules/notification/service/preferences.service.js
 *
 * Per-user notification preferences.
 *
 *   GET   /me/notification-preferences
 *   PATCH /me/notification-preferences
 *
 * Also exposes `shouldDeliver({ userId, type, channel })` for the
 * fan-out layer (notification.event.js) to consult before pushing.
 *
 * Lookup is cached in-process for 30s with the existing LRU cache —
 * notification fan-out is high-frequency and hitting Mongo on every
 * event would be wasteful. The cache is invalidated on every PATCH.
 */

import notificationPreferenceModel from "../../../DB/Model/notificationPreference.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { httpError } from "../../../utils/errors/index.js";
import { cache } from "../../../utils/cache/lru.cache.js";
import { childLogger } from "../../../utils/logger/logger.js";

const log = childLogger("notif-prefs");

// The shared LRU cache has a 60s default TTL — fast enough that a
// user flipping a setting sees it apply on the very next event after
// our explicit invalidate(), and slow enough that high-frequency
// fan-out doesn't pound Mongo.
function ck(userId) {
  return `notif-prefs|${String(userId)}`;
}

async function loadPrefs(userId) {
  const key = ck(userId);
  const cached = cache.get(key);
  if (cached) return cached;

  const doc = await notificationPreferenceModel
    .findOne({ userId })
    .lean();
  // Returning a defaults-object (rather than `null`) keeps callers
  // simple — they always get a usable shape.
  const value = doc || {
    userId,
    inApp: true,
    push: true,
    email: false,
    muted: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursTimezone: "UTC",
    byType: [],
    _implicit: true, // signal "no row exists"
  };
  cache.set(key, value);
  return value;
}

function invalidate(userId) {
  cache.delete(ck(userId));
}

// ─────────────────────────────────────────────────────────────
// Public API for the notification fan-out
// ─────────────────────────────────────────────────────────────

/**
 * Returns true if this user wants `type` notifications on `channel`.
 * `channel` is one of "inApp" | "push" | "email".
 *
 * Order of precedence:
 *   1. Hard mute → only inApp passes
 *   2. byType override for this notification.type
 *   3. Global default on the prefs doc
 *
 * Safe to call from hot paths — single in-memory cache hit after the
 * first lookup.
 */
export async function shouldDeliver({ userId, type, channel }) {
  if (!userId || !channel) return true;
  try {
    const prefs = await loadPrefs(userId);

    if (prefs.muted && channel !== "inApp") return false;

    const typed = (prefs.byType || []).find((b) => b.type === type);
    if (typed && Object.prototype.hasOwnProperty.call(typed, channel)) {
      return Boolean(typed[channel]);
    }
    return Boolean(prefs[channel]);
  } catch (err) {
    // On error, default to delivering — better one extra notification
    // than silently dropping critical ones.
    log.warn({ err, userId, type, channel }, "shouldDeliver lookup failed");
    return true;
  }
}

// ─────────────────────────────────────────────────────────────
// HTTP handlers
// ─────────────────────────────────────────────────────────────

// GET /me/notification-preferences
export const getMyPreferences = asyncHandler(async (req, res) => {
  const prefs = await loadPrefs(req.user._id);
  return successResponse({ res, data: prefs });
});

// PATCH /me/notification-preferences
//   body: { inApp?, push?, email?, muted?, quietHoursStart?, quietHoursEnd?, quietHoursTimezone?, byType? }
//   byType replaces the full array — clients send the current set every time.
export const updateMyPreferences = asyncHandler(async (req, res) => {
  const { inApp, push, email, muted, quietHoursStart, quietHoursEnd, quietHoursTimezone, byType } =
    req.body || {};

  const update = {};
  for (const [k, v] of Object.entries({
    inApp,
    push,
    email,
    muted,
    quietHoursStart,
    quietHoursEnd,
    quietHoursTimezone,
  })) {
    if (v !== undefined) update[k] = v;
  }

  if (Array.isArray(byType)) {
    // Light validation — dedupe by type, drop entries without a type.
    const seen = new Set();
    update.byType = byType
      .filter((b) => b && typeof b.type === "string" && !seen.has(b.type) && seen.add(b.type))
      .map((b) => ({
        type: b.type,
        inApp: typeof b.inApp === "boolean" ? b.inApp : undefined,
        push: typeof b.push === "boolean" ? b.push : undefined,
        email: typeof b.email === "boolean" ? b.email : undefined,
      }));
  }

  if (Object.keys(update).length === 0) {
    throw httpError(400, "No editable fields provided");
  }

  const doc = await notificationPreferenceModel.findOneAndUpdate(
    { userId: req.user._id },
    { $set: update, $setOnInsert: { userId: req.user._id } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  invalidate(req.user._id);

  return successResponse({ res, message: "Preferences updated", data: doc });
});
