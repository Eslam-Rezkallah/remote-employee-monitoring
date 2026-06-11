/**
 * utils/email/notification.email.js
 *
 * Email-channel adapter for notifications.
 *
 * The notification fan-out (notification.event.js) calls
 * `sendNotificationEmail()` when the recipient's preferences have
 * `email: true` for the type. This module:
 *   • Looks up the recipient's email address
 *   • Renders a minimal HTML template (no template engine needed)
 *   • Hands off to the existing nodemailer transport
 *
 * Best-effort: never throws into the fan-out path. Failures get
 * logged + dropped — the in-app notification row remains the
 * authoritative record.
 *
 * Rate limiting: we count outgoing emails per-user in Redis (5/hour
 * cap) so a notification storm can't accidentally spam an inbox.
 */

import userModel from "../../DB/Model/user.model.js";
import { sendEmail } from "./send.email.js";
import { getRedis } from "../redis/client.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("notification-email");

// Email-per-user-per-hour cap. Conservative — we'd rather drop a
// few notifications than get the sender domain flagged as spammy.
const EMAIL_CAP_PER_HOUR = Number(
  process.env.NOTIFICATION_EMAIL_CAP_PER_HOUR || 5,
);

async function withinRateLimit(userId) {
  const redis = getRedis();
  if (!redis) return true; // no Redis = no throttling locally
  const key = `notif-email-rate:${userId}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 3600); // 1h rolling window
    return n <= EMAIL_CAP_PER_HOUR;
  } catch (err) {
    log.warn({ err, userId }, "rate-limit lookup failed; allowing");
    return true;
  }
}

function renderHtml({ title, body, ctaUrl, ctaLabel = "View" }) {
  // Plain inline HTML — no template engine dep. Keep mobile-friendly
  // (single column, large tap target).
  return `<!doctype html>
<html><body style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f6f7f8;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
    <h2 style="margin:0 0 12px;color:#111827;font-size:18px;">${escapeHtml(title)}</h2>
    ${body ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${escapeHtml(body)}</p>` : ""}
    ${
      ctaUrl
        ? `<a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:500;">${escapeHtml(ctaLabel)}</a>`
        : ""
    }
    <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
      You're receiving this because your notification preferences allow email for this type.
      Manage preferences at <a href="${escapeHtml(process.env.FRONTEND_URL || "")}/me/notification-preferences">your settings</a>.
    </p>
  </div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send a single notification email.
 *
 * @returns Promise<boolean>  true if delivered, false if skipped/failed
 */
export async function sendNotificationEmail({
  userId,
  title,
  body = "",
  entityType,
  entityId,
}) {
  if (!userId || !title) return false;

  // Rate-limit gate first — cheap when configured, harmless when not.
  if (!(await withinRateLimit(userId))) {
    log.debug({ userId }, "email skipped: per-user hourly cap reached");
    return false;
  }

  let user;
  try {
    user = await userModel.findById(userId).select("email username");
  } catch (err) {
    log.warn({ err, userId }, "user lookup failed; email skipped");
    return false;
  }
  if (!user?.email) return false;

  const ctaUrl = buildCtaUrl({ entityType, entityId });
  try {
    await sendEmail({
      to: user.email,
      subject: title,
      text: body || title,
      html: renderHtml({ title, body, ctaUrl }),
    });
    return true;
  } catch (err) {
    // Never let an email failure ripple into the notification flow.
    log.warn({ err, userId }, "notification email send failed");
    return false;
  }
}

function buildCtaUrl({ entityType, entityId }) {
  const base = process.env.FRONTEND_URL;
  if (!base || !entityType || !entityId) return null;
  // Light routing convention — the FE owns the actual paths.
  switch (entityType) {
    case "Task":
      return `${base}/tasks/${entityId}`;
    case "Message":
      return `${base}/chat?message=${entityId}`;
    case "Project":
      return `${base}/projects/${entityId}`;
    case "Sprint":
      return `${base}/sprints/${entityId}`;
    case "Team":
      return `${base}/teams/${entityId}`;
    default:
      return base;
  }
}
