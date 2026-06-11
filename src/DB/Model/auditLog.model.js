import mongoose from "mongoose";
const { Schema, model, Types } = mongoose;

/**
 * AuditLog — security-relevant events.
 *
 * Different from `recentActivity` (the user-facing feed):
 *   • activity = product timeline ("Maitha created Task X")
 *   • audit    = security/compliance trail ("Maitha logged in from IP Y",
 *               "owner removed admin role from user Z", "DELETE org")
 *
 * Records here are APPEND-ONLY by convention. There's no update endpoint,
 * and the cleanup policy (if we add one) should be retention-based
 * (e.g., archive after 1 year) rather than per-record deletion.
 *
 * The `action` is a dot-namespaced string ("auth.login.success",
 * "org.member.role_change", "team.delete") so we can filter by prefix
 * in dashboards.
 */
const auditLogSchema = new Schema(
  {
    // Who did the action. null = system/cron action.
    actorId: { type: Types.ObjectId, ref: "User", default: null, index: true },

    // Org context. null for org-less actions (signup, login before org).
    orgId: {
      type: Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },

    // Dot-namespaced action. See module constants in
    // utils/audit/audit.actions.js for the canonical list.
    action: { type: String, required: true, index: true },

    // What was acted on. Optional — login events have no target.
    targetType: { type: String, default: null },
    targetId: { type: Types.ObjectId, default: null },

    // Free-form context (sanitize at write site — never store
    // passwords, tokens, full request bodies).
    meta: { type: Schema.Types.Mixed, default: {} },

    // Request fingerprint at the time of action.
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },

    // For login attempts / 2FA / etc., this captures success/failure.
    outcome: {
      type: String,
      enum: ["success", "failure", "denied"],
      default: "success",
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }, // append-only
);

// ── Indexes ───────────────────────────────────────────────────
// Per-org audit timeline (admin "show me everything that happened")
auditLogSchema.index({ orgId: 1, createdAt: -1 });

// Per-actor history (user's own audit trail)
auditLogSchema.index({ actorId: 1, createdAt: -1 });

// Filter by action type (e.g., all role changes in the last week)
auditLogSchema.index({ orgId: 1, action: 1, createdAt: -1 });

// Target lookup (everything that happened to user X)
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

const auditLogModel =
  mongoose.models.AuditLog || model("AuditLog", auditLogSchema);

export default auditLogModel;
