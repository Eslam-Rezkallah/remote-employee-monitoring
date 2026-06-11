import Task from "../../../DB/Model/task.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { httpError } from "../../../utils/errors/index.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import { requireTaskEditAccess } from "../../../utils/permissions/task.permissions.js";
import { notificationEvent } from "../../../utils/events/notification.event.js";

export const updateDueDate = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, taskId } = req.params;
  const { dueDate } = req.body; // allow null to clear

  const task = await dbService.findOne({
    model: Task,
    filter: { _id: taskId, organizationId: orgId, spaceId, isDeleted: false },
  });
  if (!task) return next(httpError(404, "Task not found"));

  // FIX: was previously open to any org member — now restricted to
  // assignee, reporter, or org admin/owner via the central guard.
  await requireTaskEditAccess({ task, orgId, userId: req.user._id });

  const updated = await Task.findOneAndUpdate(
    { _id: taskId, organizationId: orgId, spaceId, isDeleted: false },
    { dueDate: dueDate ? new Date(dueDate) : null },
    { new: true }
  );

  // Notify the assignee so they don't miss the deadline shift. The
  // listener (task_due_date_changed) was already wired in
  // notification.event.js — producer was missing until now.
  if (
    updated.assigneeId &&
    updated.assigneeId.toString() !== req.user._id.toString()
  ) {
    notificationEvent.emit("task_due_date_changed", {
      recipientId: updated.assigneeId.toString(),
      triggeredById: req.user._id,
      taskTitle: updated.title,
      taskId: updated._id,
      newDueDate: updated.dueDate,
    });
  }

  return successResponse({ res, message: "Due date updated", data: updated }, 200);
});

export const listDueDates = asyncHandler(async (req, res) => {
  const { orgId, spaceId } = req.params;
  const { from, to, status, priority, assigneeId, q } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  };

  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (assigneeId) filter.assigneeId = assigneeId;
  if (q) filter.$text = { $search: q };

  if (from || to) {
    const fromDate = from ? new Date(from) : new Date("1970-01-01");
    const toDate = to ? new Date(to) : new Date("2999-12-31");
    filter.dueDate = { $gte: fromDate, $lte: toDate };
  }

  const items = await Task.find(filter)
    .select("title status priority assigneeId dueDate startDate updatedAt")
    .sort({ dueDate: 1, updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("assigneeId", "username email")
    .lean();

  const total = await Task.countDocuments(filter);

  return successResponse({ res, data: { page, limit, total, items } }, 200);
});

export const bulkUpdateDueDates = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { updates } = req.body;

  const membership = await requireOrgMember(orgId, req.user._id);

  const taskIds = updates.map((u) => u.taskId);
  // FIX: need full docs (assigneeId, reporterId) for per-task permission
  // check, not just `_id` like before.
  const existing = await Task.find({
    _id: { $in: taskIds },
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  }).select("_id assigneeId reporterId");

  if (existing.length !== updates.length) {
    return next(httpError(404, "One or more tasks were not found in this space"));
  }

  // Org admins/owners get a free pass; everyone else must be either the
  // assignee or the reporter for EVERY task in the bulk batch. We refuse
  // the whole batch on the first denial — partial-success semantics in
  // bulk endpoints are a footgun for client retry logic.
  const userId = req.user._id;
  const isAdmin =
    membership.role === "admin" || membership.role === "owner";
  if (!isAdmin) {
    for (const t of existing) {
      const ok =
        (t.assigneeId && t.assigneeId.toString() === userId.toString()) ||
        (t.reporterId && t.reporterId.toString() === userId.toString());
      if (!ok) {
        return next(
          httpError(
            403,
            `You can only change due dates for tasks you are the assignee or reporter of (task ${t._id})`,
          ),
        );
      }
    }
  }

  await Promise.all(
    updates.map((u) =>
      Task.updateOne(
        { _id: u.taskId, organizationId: orgId, spaceId, isDeleted: false },
        { dueDate: u.dueDate ? new Date(u.dueDate) : null }
      )
    )
  );

  const items = await Task.find({
    _id: { $in: taskIds },
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  })
    .select("_id title dueDate status priority assigneeId")
    .populate("assigneeId", "username email")
    .lean();

  return successResponse(
    {
      res,
      message: "Due dates updated",
      data: { updatedCount: items.length, items },
    },
    200
  );
});
