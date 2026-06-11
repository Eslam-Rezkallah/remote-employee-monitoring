/**
 * Append-only audit logger.
 *
 *   recordAudit({ actorId, orgId, action, targetType, targetId, meta, req, outcome })
 *
 * Always fire-and-forget — failures here MUST NOT break the user-facing
 * request. We catch + log and move on.
 *
 * The `req` object is optional; when passed we extract IP and User-Agent
 * so callers don't have to pass them explicitly.
 *
 * Usage pattern (in a service):
 *
 *   await recordAudit({
 *     req,
 *     actorId: req.user._id,
 *     orgId,
 *     action: auditActions.ORG_MEMBER_REMOVE,
 *     targetType: "User",
 *     targetId: memberId,
 *     meta: { previousRole: target.role },
 *   });
 */

import auditLogModel from "../../DB/Model/auditLog.model.js";
import { childLogger } from "../logger/logger.js";

const log = childLogger("audit");

export async function recordAudit({
  actorId = null,
  orgId = null,
  action,
  targetType = null,
  targetId = null,
  meta = {},
  outcome = "success",
  req = null,
} = {}) {
  if (!action) {
    log.warn("recordAudit called without action — skipped");
    return;
  }

  // Pull request fingerprint from req if available. We DO NOT log the
  // Authorization header or any body — that's the redaction policy.
  let ipAddress = null;
  let userAgent = null;
  if (req) {
    ipAddress =
      req.ip ||
      req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;
    userAgent = req.headers?.["user-agent"] || null;
  }

  try {
    await auditLogModel.create({
      actorId,
      orgId,
      action,
      targetType,
      targetId,
      meta,
      outcome,
      ipAddress,
      userAgent,
    });
  } catch (err) {
    // Don't throw — the audit log is observability, not a request gate.
    log.error({ err, action }, "audit write failed");
  }
}

/**
 * Convenience helper to record a denied/failed action — same as
 * recordAudit but with outcome="failure" by default.
 */
export function recordAuditFailure(opts) {
  return recordAudit({ ...opts, outcome: opts.outcome ?? "failure" });
}
