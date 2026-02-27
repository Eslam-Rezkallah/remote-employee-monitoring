// tasks.controller.js
import mongoose from "mongoose";

import Task from "../../../DB/Model/task.model.js";
import Space from "../../../DB/Model/space.model.js";
import memberModel from "../../../DB/Model/member.model.js";

import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { logActivity } from "../../../utils/activity/activity.logger.js";

/* =========================
   Helpers (guards)
========================= */

async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });

  if (!member) {
    throw new Error("Not a member of this organization", { cause: 403 });
  }

  return member;
}

async function requireSpace(spaceId, orgId) {
  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });

  if (!space) {
    throw new Error("Space not found", { cause: 404 });
  }

  return space;
}

function toObjectId(id) {
  if (!id) return null;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error("Invalid ObjectId", { cause: 400 });
  }
  return new mongoose.Types.ObjectId(id);
}

/* =========================
   Controllers
========================= */

// POST /org/:orgId/spaces/:spaceId/tasks
export const createTask = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const task = await dbService.create({
    model: Task,
    data: {
      ...req.body,
      organizationId: orgId,
      spaceId,
      reporterId: req.user._id,
      isDeleted: false,
    },
  });

  // Activity log (create)
  await logActivity({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: "Task",
    entityId: task._id,
    action: "create",
    meta: {
      title: task.title,
      priority: task.priority,
      status: task.status,
    },
  });

  return successResponse({ res, message: "Task created", data: task }, 201);
});

// GET /org/:orgId/spaces/:spaceId/tasks?status=&priority=&assigneeId=&sprintId=&q=&page=&limit=
export const listTasks = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  };

  // index-friendly filters
  if (req.query.status) filter.status = req.query.status;
  if (req.query.priority) filter.priority = req.query.priority;

  if (req.query.sprintId !== undefined) {
    // allow sprintId=null style behavior if you pass "null"
    filter.sprintId =
      req.query.sprintId === "null" ? null : toObjectId(req.query.sprintId);
  }

  if (req.query.assigneeId) {
    filter.assigneeId = toObjectId(req.query.assigneeId);
  }

  // text search (requires a text index on Task)
  const hasSearch = Boolean(req.query.q && String(req.query.q).trim());
  if (hasSearch) {
    filter.$text = { $search: String(req.query.q).trim() };
  }

  // sort
  const sort = hasSearch
    ? { score: { $meta: "textScore" } }
    : { updatedAt: -1 };

  const query = Task.find(filter).select(
    "title status priority assigneeId reporterId sprintId points dueDate updatedAt createdAt"
  );

  if (hasSearch) {
    query.select({ score: { $meta: "textScore" } });
  }

  const items = await query.sort(sort).skip(skip).limit(limit).lean();
  const total = await Task.countDocuments(filter);

  return successResponse({ res, data: { page, limit, total, items } }, 200);
});

// GET /org/:orgId/spaces/:spaceId/tasks/backlog?page=&limit=
// backlog = not Done + not in sprint
export const backlog = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    organizationId: orgId,
    spaceId,
    isDeleted: false,
    status: { $ne: "Done" },
    sprintId: null,
  };

  const items = await Task.find(filter)
    .select("title status priority assigneeId points dueDate updatedAt")
    .sort({ priority: -1, updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Task.countDocuments(filter);

  return successResponse({ res, data: { page, limit, total, items } }, 200);
});

// GET /org/:orgId/spaces/:spaceId/tasks/:taskId
export const getTask = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, taskId } = req.params;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    return next(new Error("Invalid taskId", { cause: 400 }));
  }

  const task = await Task.findOne({
    _id: taskId,
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  })
    .select("-__v")
    .populate("assigneeId", "username email")
    .populate("reporterId", "username email");

  if (!task) {
    return next(new Error("Task not found", { cause: 404 }));
  }

  return successResponse({ res, data: task }, 200);
});
