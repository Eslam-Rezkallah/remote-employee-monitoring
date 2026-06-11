import Task from "../../../DB/Model/task.model.js";
import Space from "../../../DB/Model/space.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import { httpError } from "../../../utils/errors/index.js";

async function requireSpace(spaceId, orgId) {
  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) throw httpError(404, "Space not found");
}

// GET /org/:orgId/spaces/:spaceId/backlog?status=&priority=&assigneeId=&q=&page=&limit=
export const backlog = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { status, priority, assigneeId, q, page = 1, limit = 20 } = req.query;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const filter = { organizationId: orgId, spaceId, isDeleted: false };

  // default backlog: not done
  filter.status = status ? status : { $ne: "Done" };
  if (priority) filter.priority = priority;
  if (assigneeId) filter.assigneeId = assigneeId;
  if (q) filter.$text = { $search: q };

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Task.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Task.countDocuments(filter),
  ]);

  return successResponse({ res, data: { items, total, page: Number(page), limit: Number(limit) } }, 200);
});

// GET /org/:orgId/spaces/:spaceId/timeline?from=&to=&assigneeId=
export const timeline = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { from, to, assigneeId } = req.query;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const filter = { organizationId: orgId, spaceId, isDeleted: false };

  if (assigneeId) filter.assigneeId = assigneeId;

  // tasks that overlap [from,to] using startDate/dueDate
  if (from || to) {
    const fromDate = from ? new Date(from) : new Date("1970-01-01");
    const toDate = to ? new Date(to) : new Date("2999-12-31");

    filter.$or = [
      { startDate: { $gte: fromDate, $lte: toDate } },
      { dueDate: { $gte: fromDate, $lte: toDate } },
      { $and: [{ startDate: { $lte: fromDate } }, { dueDate: { $gte: toDate } }] },
    ];
  }

  const items = await Task.find(filter).sort({ dueDate: 1, startDate: 1, createdAt: -1 });

  return successResponse({ res, data: { items } }, 200);
});
