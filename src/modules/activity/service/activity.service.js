import RecentActivity from "../../../DB/Model/recentActivity.model.js";
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

function groupByDay(items) {
  const grouped = {};
  for (const it of items) {
    const day = new Date(it.createdAt).toISOString().slice(0, 10); // YYYY-MM-DD
    if (!grouped[day]) grouped[day] = [];
    grouped[day].push(it);
  }

  return Object.entries(grouped)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([date, activities]) => ({ date, activities }));
}

export const getOrgActivity = asyncHandler(async (req, res) => {
  const { orgId } = req.params;
  const { spaceId, actorId, entityType, action, from, to } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const { page, limit, skip } = getPagination(req.query);

  const filter = { orgId, isDeleted: false };
  if (spaceId) filter.spaceId = spaceId;
  if (actorId) filter.actorId = actorId;
  if (entityType) filter.entityType = entityType;
  if (action) filter.action = action;

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(from);
    if (to) filter.createdAt.$lte = new Date(to);
  }

  const items = await RecentActivity.find(filter)
    .select("actorId spaceId entityType entityId action meta createdAt")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await RecentActivity.countDocuments(filter);

  return successResponse({
    res,
    data: {
      page,
      limit,
      total,
      items,
      groupedByDate: groupByDay(items),
    },
  });
});
