import StarredItem, { starredEntityTypes } from "../../../DB/Model/starredItem.model.js";
import Task from "../../../DB/Model/task.model.js";
import Space from "../../../DB/Model/space.model.js";
import Sprint from "../../../DB/Model/sprint.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { logActivity } from "../../../utils/activity/activity.logger.js";
import { activityActions } from "../../../DB/Model/recentActivity.model.js";
import { EntityType } from "../../../DB/Model/constants/entityTypes.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import { httpError } from "../../../utils/errors/index.js";
const modelMap = {
  [starredEntityTypes.Task]: Task,
  [starredEntityTypes.Space]: Space,
  [starredEntityTypes.Sprint]: Sprint,
};


const searchableFieldsByType = {
  [starredEntityTypes.Task]: ["title", "description", "labels"],
  [starredEntityTypes.Space]: ["name", "type"],
  [starredEntityTypes.Sprint]: ["name", "goal", "status"],
};

function escapeRegex(text = "") {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchText(type, entity, qRegex) {
  const fields = searchableFieldsByType[type] || [];
  for (const field of fields) {
    const value = entity?.[field];
    if (Array.isArray(value)) {
      if (value.some((v) => qRegex.test(String(v)))) return true;
      continue;
    }
    if (value !== undefined && value !== null && qRegex.test(String(value))) return true;
  }
  return false;
}

async function loadEntitiesByType(type, ids) {
  const Model = modelMap[type];
  if (!Model || !ids?.length) return [];

  let select = "_id";
  if (type === starredEntityTypes.Task) {
    select = "_id title description labels status priority dueDate updatedAt";
  } else if (type === starredEntityTypes.Space) {
    select = "_id name type updatedAt";
  } else if (type === starredEntityTypes.Sprint) {
    select = "_id name goal status startDate endDate updatedAt";
  }

  return Model.find({ _id: { $in: ids }, isDeleted: false }).select(select).lean();
}

export const toggleStar = asyncHandler(async (req, res, next) => {
  const { orgId, entityType, entityId, spaceId } = req.body;

  if (!orgId || !entityType || !entityId) {
    return next(httpError(400, "orgId, entityType, entityId are required"));
  }
  if (!Object.values(starredEntityTypes).includes(entityType)) {
    return next(httpError(400, "Invalid entityType"));
  }

  await requireOrgMember(orgId, req.user._id);

  // ensure entity exists
  const Model = modelMap[entityType];
  const exists = await dbService.findOne({ model: Model, filter: { _id: entityId, isDeleted: false } });
  if (!exists) return next(httpError(404, "Entity not found"));

  const found = await StarredItem.findOne({ userId: req.user._id, entityType, entityId });

  const track = req.logActivity || logActivity;

  if (found) {
    await StarredItem.deleteOne({ _id: found._id });

    await track({
      actorId: req.user._id,
      orgId,
      spaceId,
      entityType: EntityType[entityType] || entityType,

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

  await track({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: EntityType[entityType] || entityType,
    entityId,
    action: activityActions.Star,
    meta: {},
  });

  return successResponse({ res, message: "Starred", data: { starred: true } }, 201);
});

export const listStars = asyncHandler(async (req, res, next) => {
  const { orgId, entityType, limit = 50 } = req.query;

  if (!orgId) return next(httpError(400, "orgId is required"));
  await requireOrgMember(orgId, req.user._id);

  const filter = { userId: req.user._id, orgId };
  if (entityType) filter.entityType = entityType;

  const items = await StarredItem.find(filter)
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  return successResponse({ res, data: { items } }, 200);
});

// BE-7.6
// GET /stars/search?orgId=&q=&entityType=&page=&limit=
export const searchStars = asyncHandler(async (req, res, next) => {
  const { orgId, q = "", entityType, page = 1, limit = 20 } = req.query;

  if (!orgId) return next(httpError(400, "orgId is required"));
  if (entityType && !Object.values(starredEntityTypes).includes(entityType)) {
    return next(httpError(400, "Invalid entityType"));
  }

  await requireOrgMember(orgId, req.user._id);

  const baseFilter = { userId: req.user._id, orgId };
  if (entityType) baseFilter.entityType = entityType;

  const stars = await StarredItem.find(baseFilter)
    .sort({ createdAt: -1 })
    .lean();

  const idsByType = {
    [starredEntityTypes.Task]: [],
    [starredEntityTypes.Space]: [],
    [starredEntityTypes.Sprint]: [],
  };

  for (const s of stars) {
    if (idsByType[s.entityType]) idsByType[s.entityType].push(s.entityId);
  }

  const [tasks, spaces, sprints] = await Promise.all([
    loadEntitiesByType(starredEntityTypes.Task, idsByType[starredEntityTypes.Task]),
    loadEntitiesByType(starredEntityTypes.Space, idsByType[starredEntityTypes.Space]),
    loadEntitiesByType(starredEntityTypes.Sprint, idsByType[starredEntityTypes.Sprint]),
  ]);

  const entityByTypeAndId = {
    [starredEntityTypes.Task]: new Map(tasks.map((x) => [x._id.toString(), x])),
    [starredEntityTypes.Space]: new Map(spaces.map((x) => [x._id.toString(), x])),
    [starredEntityTypes.Sprint]: new Map(sprints.map((x) => [x._id.toString(), x])),
  };

  const trimmedQ = String(q || "").trim();
  const qRegex = trimmedQ ? new RegExp(escapeRegex(trimmedQ), "i") : null;

  const merged = stars
    .map((s) => {
      const entity = entityByTypeAndId[s.entityType]?.get(String(s.entityId)) || null;
      if (!entity) return null;
      if (qRegex && !matchText(s.entityType, entity, qRegex)) return null;

      return {
        _id: s._id,
        entityType: s.entityType,
        entityId: s.entityId,
        orgId: s.orgId,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        entity,
      };
    })
    .filter(Boolean);

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;
  const items = merged.slice(skip, skip + limitNum);

  return successResponse({
    res,
    data: {
      page: pageNum,
      limit: limitNum,
      total: merged.length,
      q: trimmedQ,
      items,
    },
  });
});
