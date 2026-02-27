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
  const { taskId } = req.params;
  const { dueDate } = req.body; // allow null to clear

  const task = await dbService.findOne({
    model: Task,
    filter: { _id: taskId, isDeleted: false },
  });
  if (!task) return next(new Error("Task not found", { cause: 404 }));

  await requireOrgMember(task.organizationId, req.user._id);

  const updated = await Task.findOneAndUpdate(
    { _id: taskId, isDeleted: false },
    { dueDate: dueDate ? new Date(dueDate) : null },
    { new: true }
  );

  return successResponse({ res, message: "Due date updated", data: updated }, 200);
});
export const listTasks = asyncHandler(async (req, res) => {
  const { orgId, spaceId } = req.params;

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  };

  const items = await Task.find(filter)
    .select("title status priority assigneeId dueDate updatedAt")
    .sort({ updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Task.countDocuments(filter);

  return successResponse({ res, data: { page, limit, total, items } }, 200);
});