import Task from "../../../DB/Model/task.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";

// OPTIONAL: if you have these models, you can uncomment and use them
// import Comment from "../../../DB/Model/comment.model.js";
// import WorkSession from "../../../DB/Model/worksession.model.js";

async function requireOrgMember(orgId, userId) {
  if (!orgId) return; // orgId optional in assignedTasks
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member) throw new Error("Not a member of this organization", { cause: 403 });
  return member;
}

/**
 * BE-6.2 Assigned tasks
 * GET /me/tasks/assigned?orgId=&spaceId=&status=&from=&to=&page=&limit=
 */
export const assignedTasks = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, status, priority, from, to, page = 1, limit = 20 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const filter = {
    isDeleted: false,
    assigneeId: req.user._id,
  };
  if (orgId) filter.organizationId = orgId;
  if (spaceId) filter.spaceId = spaceId;
  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  // dueDate filter
  if (from || to) {
    filter.dueDate = {};
    if (from) filter.dueDate.$gte = new Date(from);
    if (to) filter.dueDate.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Task.find(filter).sort({ dueDate: 1, createdAt: -1 }).skip(skip).limit(Number(limit)),
    Task.countDocuments(filter),
  ]);

  return successResponse(
    { res, data: { items, total, page: Number(page), limit: Number(limit) } },
    200
  );
});

/**
 * BE-6.1 Worked-on tasks (lightweight version)
 * We treat "worked on" as:
 * - tasks assigned to you OR reported by you
 * - AND updated recently (updatedAt within last N days)
 *
 * Later (Phase 7), you'll use Activity logs for a perfect definition.
 *
 * GET /me/tasks/worked-on?orgId=&spaceId=&days=&limit=
 */
export const workedOnTasks = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, days = 14, limit = 30 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

  const filter = { isDeleted: false, updatedAt: { $gte: since } };
  if (orgId) filter.organizationId = orgId;
  if (spaceId) filter.spaceId = spaceId;

  filter.$or = [
    { assigneeId: req.user._id },
    { reporterId: req.user._id },
  ];

  const items = await Task.find(filter)
    .sort({ updatedAt: -1 })
    .limit(Number(limit));

  return successResponse({ res, data: { items, since } }, 200);
});

/**
 * BE-6.4 For You (rule-based ranking)
 *
 * Uses:
 * - due soon
 * - priority
 * - status (Todo/InProgress favored)
 * - stale tasks penalty/boost
 * - "worked on" boost (recently updated by you)
 *
 * GET /me/for-you?orgId=&spaceId=&days=&limit=
 */
export const forYou = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, days = 14, limit = 15 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const now = Date.now();
  const since = new Date(now - Number(days) * 24 * 60 * 60 * 1000);

  // Candidate pool: assigned to you OR recently worked-on
  const baseFilter = { isDeleted: false };
  if (orgId) baseFilter.organizationId = orgId;
  if (spaceId) baseFilter.spaceId = spaceId;

  const candidates = await Task.find({
    ...baseFilter,
    $or: [
      { assigneeId: req.user._id },
      { reporterId: req.user._id, updatedAt: { $gte: since } },
      { assigneeId: req.user._id, updatedAt: { $gte: since } },
    ],
  }).limit(500);

  const priorityScore = (p) =>
    p === "Urgent" ? 40 : p === "High" ? 30 : p === "Medium" ? 15 : 5;

  const statusScore = (s) =>
    s === "InProgress" ? 15 : s === "Todo" ? 10 : s === "Done" ? -50 : 0;

  const dueSoonScore = (dueDate) => {
    if (!dueDate) return 0;
    const d = new Date(dueDate).getTime();
    const diffDays = Math.ceil((d - now) / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return 35;      // overdue
    if (diffDays <= 1) return 30;
    if (diffDays <= 3) return 20;
    if (diffDays <= 7) return 10;
    return 0;
  };

  const staleScore = (updatedAt) => {
    const u = new Date(updatedAt).getTime();
    const diffDays = Math.ceil((now - u) / (24 * 60 * 60 * 1000));
    // tasks untouched for long time get a small boost (reminder)
    if (diffDays >= 14) return 10;
    if (diffDays >= 7) return 5;
    return 0;
  };

  const workedOnBoost = (task) => {
    const u = new Date(task.updatedAt).getTime();
    if (u >= since.getTime()) return 8;
    return 0;
  };

  const scored = candidates
    .map((t) => {
      const score =
        priorityScore(t.priority) +
        statusScore(t.status) +
        dueSoonScore(t.dueDate) +
        staleScore(t.updatedAt) +
        workedOnBoost(t);

      const reasons = [];
      if (t.dueDate) reasons.push("due-date");
      if (t.priority) reasons.push(`priority:${t.priority}`);
      if (t.status) reasons.push(`status:${t.status}`);
      if (new Date(t.updatedAt) >= since) reasons.push("recently-updated");
      if (t.assigneeId?.toString?.() === req.user._id.toString?.()) reasons.push("assigned-to-you");

      return { task: t, score, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(limit));

  return successResponse(
    { res, data: { items: scored, meta: { since, limit: Number(limit) } } },
    200
  );
});
