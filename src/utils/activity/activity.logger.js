import RecentActivity from "../../DB/Model/recentActivity.model.js";

export async function logActivity({
  actorId,
  orgId,
  spaceId = null,
  entityType,
  entityId,
  action,
  meta = {},
}) {
  // minimal validation (avoid crashing production)
  if (!actorId || !orgId || !entityType || !entityId || !action) return;

  try {
    await RecentActivity.create({
      actorId,
      orgId,
      spaceId,
      entityType,
      entityId,
      action,
      meta,
      isDeleted: false,
    });
  } catch (err) {
    // Do not crash request if logging fails
    console.error("Activity log failed:", err?.message || err);
  }
}
