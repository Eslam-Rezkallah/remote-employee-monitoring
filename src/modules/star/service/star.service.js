import StarredItem, { starredEntityTypes } from "../../../DB/Model/starredItem.model.js";
import Task from "../../../DB/Model/task.model.js";
import Space from "../../../DB/Model/space.model.js";
import Sprint from "../../../DB/Model/sprint.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { logActivity } from "../../../utils/activity/activity.logger.js";
import { activityActions, entityTypes } from "../../../DB/Model/recentActivity.model.js";

const modelMap = {
  [starredEntityTypes.Task]: Task,
  [starredEntityTypes.Space]: Space,
  [starredEntityTypes.Sprint]: Sprint,
};

async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member) throw new Error("Not a member of this organization", { cause: 403 });
}

export const toggleStar = asyncHandler(async (req, res, next) => {
  const { orgId, entityType, entityId, spaceId } = req.body;

  if (!orgId || !entityType || !entityId) {
    return next(new Error("orgId, entityType, entityId are required", { cause: 400 }));
  }
  if (!Object.values(starredEntityTypes).includes(entityType)) {
    return next(new Error("Invalid entityType", { cause: 400 }));
  }

  await requireOrgMember(orgId, req.user._id);

  // ensure entity exists
  const Model = modelMap[entityType];
  const exists = await dbService.findOne({ model: Model, filter: { _id: entityId, isDeleted: false } });
  if (!exists) return next(new Error("Entity not found", { cause: 404 }));

  const found = await StarredItem.findOne({ userId: req.user._id, entityType, entityId });

  if (found) {
    await StarredItem.deleteOne({ _id: found._id });

    await logActivity({
      actorId: req.user._id,
      orgId,
      spaceId,
      entityType: entityTypes[entityType] || entityType,
      entityId,
      action: activityActions.Unstar,
      meta: {},
    });

    return successResponse({ res, message: "Unstarred", data: { starred: false } }, 200);
  }

  await StarredItem.create({
    userId: req.user._id,
    orgId,
    entityType,
    entityId,
  });

  await logActivity({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: entityTypes[entityType] || entityType,
    entityId,
    action: activityActions.Star,
    meta: {},
  });

  return successResponse({ res, message: "Starred", data: { starred: true } }, 201);
});

export const listStars = asyncHandler(async (req, res, next) => {
  const { orgId, entityType, limit = 50 } = req.query;

  if (!orgId) return next(new Error("orgId is required", { cause: 400 }));
  await requireOrgMember(orgId, req.user._id);

  const filter = { userId: req.user._id, orgId };
  if (entityType) filter.entityType = entityType;

  const items = await StarredItem.find(filter)
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  return successResponse({ res, data: { items } }, 200);
});
