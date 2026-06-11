// tasks.controller.js
import mongoose from "mongoose";

import Task, { taskStatus } from "../../../DB/Model/task.model.js";
import { isValidStatusForSpace } from "./task.workflow.service.js";
import Space from "../../../DB/Model/space.model.js";
import memberModel from "../../../DB/Model/member.model.js";

import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { logActivity } from "../../../utils/activity/activity.logger.js";
import { httpError } from "../../../utils/errors/index.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import {
  requireTaskEditAccess,
  requireTaskAssignAccess,
  requireTaskDeleteAccess,
} from "../../../utils/permissions/task.permissions.js";
import { notificationEvent } from "../../../utils/events/notification.event.js";

/* =========================
   Helpers (guards)
========================= */

async function requireSpace(spaceId, orgId) {
  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });

  if (!space) {
    throw httpError(404, "Space not found");
  }

  return space;
}

function toObjectId(id) {
  if (!id) return null;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw httpError(400, "Invalid ObjectId");
  }
  return new mongoose.Types.ObjectId(id);
}

/**
 * Validates an assigneeId before writing it to a task: the user must
 * be an active member of the same organization. Pass `null` to clear.
 */
async function ensureAssigneeInOrg(orgId, assigneeId) {
  if (!assigneeId) return null;
  if (!mongoose.Types.ObjectId.isValid(assigneeId)) {
    throw httpError(400, "Invalid assigneeId");
  }
  const m = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: assigneeId, isActive: true },
  });
  if (!m) {
    throw httpError(400, "Assignee is not an active member of this organization");
  }
  return assigneeId;
}

/* =========================
   Controllers
========================= */

// POST /org/:orgId/spaces/:spaceId/tasks
export const createTask = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  // If an assignee is supplied at create time, validate them now —
  // otherwise we'd silently store an orphan reference.
  if (req.body.assigneeId) {
    await ensureAssigneeInOrg(orgId, req.body.assigneeId);
  }

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
  const track = req.logActivity || logActivity;
  await track({
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
    return next(httpError(400, "Invalid taskId"));
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
    return next(httpError(404, "Task not found"));
  }

  return successResponse({ res, data: task }, 200);
});

/* =========================
   MUTATIONS
========================= */

/**
 * Internal: load a non-deleted task scoped to (orgId, spaceId).
 * Centralized so every mutation uses the same scoping rules — prevents
 * cross-space leaks via crafted URLs.
 */
async function loadScopedTask({ orgId, spaceId, taskId }) {
  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    throw httpError(400, "Invalid taskId");
  }
  const task = await Task.findOne({
    _id: taskId,
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  });
  if (!task) throw httpError(404, "Task not found");
  return task;
}

// PATCH /org/:orgId/spaces/:spaceId/tasks/:taskId
// Update mutable fields (title, description, type, priority, labels,
// startDate, parentTaskId). status and assignee have dedicated endpoints.
export const updateTask = asyncHandler(async (req, res) => {
  const { orgId, spaceId, taskId } = req.params;
  const task = await loadScopedTask({ orgId, spaceId, taskId });

  await requireTaskEditAccess({ task, orgId, userId: req.user._id });

  // Whitelist of fields editable through this endpoint. status and
  // assigneeId are intentionally excluded — they have their own
  // endpoints with stricter access rules and side effects.
  const allowed = [
    "title",
    "description",
    "type",
    "priority",
    "labels",
    "startDate",
    "parentTaskId",
    "points",
    "sprintId",
  ];
  const patch = {};
  for (const f of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, f)) {
      patch[f] = req.body[f];
    }
  }
  if (Object.keys(patch).length === 0) {
    throw httpError(400, "No editable fields provided");
  }

  const updated = await Task.findByIdAndUpdate(task._id, patch, {
    new: true,
    runValidators: true,
  })
    .populate("assigneeId", "username email")
    .populate("reporterId", "username email");

  // Activity log
  const track = req.logActivity || logActivity;
  await track({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: "Task",
    entityId: task._id,
    action: "update",
    meta: { fields: Object.keys(patch) },
  });

  return successResponse({ res, message: "Task updated", data: updated });
});

// PATCH /org/:orgId/spaces/:spaceId/tasks/:taskId/status
// Kanban-style status transition. Validates against the space's
// custom workflow if one exists, otherwise against the built-in
// Todo/InProgress/Done enum.
export const changeStatus = asyncHandler(async (req, res) => {
  const { orgId, spaceId, taskId } = req.params;
  const { status } = req.body;

  // Load the task first so we know its `type` — workflow selection is
  // type-aware (Bug can have a different workflow than Task).
  const task = await loadScopedTask({ orgId, spaceId, taskId });

  // Workflow-aware check. Falls back to the built-in enum when the
  // space hasn't defined a custom workflow.
  const allowed = await isValidStatusForSpace(spaceId, status, task.type);
  if (!allowed) {
    throw httpError(
      400,
      `Status "${status}" is not in this space's workflow for ${task.type} tasks. ` +
        `Built-in defaults are ${Object.values(taskStatus).join(", ")}; ` +
        `check GET /org/${orgId}/spaces/${spaceId}/workflow for the full list.`,
    );
  }
  await requireTaskEditAccess({ task, orgId, userId: req.user._id });

  if (task.status === status) {
    // No-op rather than 409 — drag-drop UIs can fire the same status
    // multiple times during a single move; failing would surface as a
    // spurious error.
    return successResponse({
      res,
      message: "Status unchanged",
      data: task,
    });
  }

  const previousStatus = task.status;
  task.status = status;
  await task.save();

  const track = req.logActivity || logActivity;
  await track({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: "Task",
    entityId: task._id,
    action: "status_change",
    meta: { from: previousStatus, to: status },
  });

  // Notify the watchers (assignee + reporter, excluding the actor)
  // so the notification.event listener can fan out push + email +
  // in-app. Producer was missing — listener has been here all along.
  const watcherIds = [task.assigneeId, task.reporterId]
    .filter(Boolean)
    .map((id) => id.toString())
    .filter((id) => id !== req.user._id.toString());
  if (watcherIds.length > 0) {
    notificationEvent.emit("task_status_changed", {
      watcherIds,
      triggeredById: req.user._id,
      changerName: req.user.username,
      taskTitle: task.title,
      taskId: task._id,
      newStatus: status,
    });
  }

  return successResponse({ res, message: "Status updated", data: task });
});

// PATCH /org/:orgId/spaces/:spaceId/tasks/:taskId/assign
// Pass assigneeId = null to unassign.
export const assignTask = asyncHandler(async (req, res) => {
  const { orgId, spaceId, taskId } = req.params;
  const { assigneeId } = req.body;

  const task = await loadScopedTask({ orgId, spaceId, taskId });
  await requireTaskAssignAccess({ task, orgId, userId: req.user._id });

  // Treat undefined the same as null (clear). Validate non-null target.
  const target = assigneeId ?? null;
  await ensureAssigneeInOrg(orgId, target);

  if (
    (task.assigneeId?.toString() || null) === (target?.toString() || null)
  ) {
    return successResponse({
      res,
      message: "Assignee unchanged",
      data: task,
    });
  }

  const previousAssignee = task.assigneeId;
  task.assigneeId = target;
  await task.save();

  const populated = await Task.findById(task._id)
    .populate("assigneeId", "username email")
    .populate("reporterId", "username email");

  const track = req.logActivity || logActivity;
  await track({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: "Task",
    entityId: task._id,
    action: target ? "assign" : "unassign",
    meta: {
      from: previousAssignee ? previousAssignee.toString() : null,
      to: target ? target.toString() : null,
    },
  });

  // Notify the new assignee (if any). Skip when the user assigned
  // themselves — no point self-notifying.
  if (target && target.toString() !== req.user._id.toString()) {
    notificationEvent.emit("task_assigned", {
      recipientId: target.toString(),
      triggeredById: req.user._id,
      assignerName: req.user.username,
      taskTitle: task.title,
      taskId: task._id,
    });
  }

  return successResponse({
    res,
    message: target ? "Task assigned" : "Task unassigned",
    data: populated,
  });
});

// DELETE /org/:orgId/spaces/:spaceId/tasks/:taskId
// Soft delete. Restores require a separate (admin-only) restore endpoint
// which we haven't built yet — flag this if you need undo from the UI.
export const deleteTask = asyncHandler(async (req, res) => {
  const { orgId, spaceId, taskId } = req.params;

  const task = await loadScopedTask({ orgId, spaceId, taskId });
  await requireTaskDeleteAccess({ task, orgId, userId: req.user._id });

  task.isDeleted = true;
  await task.save();

  const track = req.logActivity || logActivity;
  await track({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: "Task",
    entityId: task._id,
    action: "delete",
    meta: { title: task.title },
  });

  return successResponse({ res, message: "Task deleted" });
});
