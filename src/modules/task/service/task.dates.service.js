import Task from "../../../DB/Model/task.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";

async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member) throw new Error("Not a member of this organization", { cause: 403 });
}

export const updateDueDate = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, taskId } = req.params;
  const { dueDate } = req.body; // allow null to clear

  await requireOrgMember(orgId, req.user._id);

  const task = await dbService.findOne({
    model: Task,
    filter: { _id: taskId, organizationId: orgId, spaceId, isDeleted: false },
  });
  if (!task) return next(new Error("Task not found", { cause: 404 }));

  const updated = await Task.findOneAndUpdate(
    { _id: taskId, organizationId: orgId, spaceId, isDeleted: false },
    { dueDate: dueDate ? new Date(dueDate) : null },
    { new: true }
  );

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

  await requireOrgMember(orgId, req.user._id);

  const taskIds = updates.map((u) => u.taskId);
  const existing = await Task.find({
    _id: { $in: taskIds },
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  }).select("_id");

  if (existing.length !== updates.length) {
    return next(new Error("One or more tasks were not found in this space", { cause: 404 }));
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
