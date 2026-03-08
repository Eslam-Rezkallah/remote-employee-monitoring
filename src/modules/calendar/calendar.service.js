import Task from "../../DB/Model/task.model.js";
import Sprint from "../../DB/Model/sprint.model.js";
import Space from "../../DB/Model/space.model.js";
import memberModel from "../../DB/Model/member.model.js";
import * as dbService from "../../DB/db.service.js";
import { asyncHandler } from "../../utils/response/error.response.js";
import { successResponse } from "../../utils/response/success.response.js";

async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member) throw new Error("Not a member of this organization", { cause: 403 });
}

async function requireSpace(spaceId, orgId) {
  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) throw new Error("Space not found", { cause: 404 });
}

export const calendar = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { from, to } = req.query;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const fromDate = from ? new Date(from) : new Date("1970-01-01");
  const toDate = to ? new Date(to) : new Date("2999-12-31");

  const tasks = await Task.find({
    organizationId: orgId,
    spaceId,
    isDeleted: false,
    $or: [
      { startDate: { $gte: fromDate, $lte: toDate } },
      { dueDate: { $gte: fromDate, $lte: toDate } },
      { $and: [{ startDate: { $lte: fromDate } }, { dueDate: { $gte: toDate } }] },
    ],
  }).sort({ dueDate: 1 });

  const sprints = await Sprint.find({
    organizationId: orgId,
    spaceId,
    isDeleted: false,
    $or: [
      { startDate: { $gte: fromDate, $lte: toDate } },
      { endDate: { $gte: fromDate, $lte: toDate } },
      { $and: [{ startDate: { $lte: fromDate } }, { endDate: { $gte: toDate } }] },
    ],
  }).sort({ startDate: 1 });

  return successResponse({ res, data: { tasks, sprints } }, 200);
});
