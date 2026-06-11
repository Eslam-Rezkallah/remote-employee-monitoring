import Sprint, { sprintStatus } from "../../../DB/Model/sprint.model.js";
import Space from "../../../DB/Model/space.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";

// ✅ ADD THIS IMPORT
import { logActivity } from "../../../utils/activity/activity.logger.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import { httpError } from "../../../utils/errors/index.js";

async function requireSpace(spaceId, orgId) {
  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) throw httpError(404, "Space not found");
  return space;
}

// GET /org/:orgId/spaces/:spaceId/sprints?status=&page=&limit=
// Lists sprints in a space, newest first. The FE uses this to render
// the sprint backlog + sprint planning board.
export const listSprints = asyncHandler(async (req, res) => {
  const { orgId, spaceId } = req.params;
  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const filter = {
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  };
  if (req.query.status) filter.status = req.query.status;

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Sprint.find(filter)
      .sort({ startDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "username email image")
      .lean(),
    Sprint.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: { items, total, page, limit, pages: Math.ceil(total / limit) },
  });
});

// GET /org/:orgId/spaces/:spaceId/sprints/:sprintId
export const getSprint = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, sprintId } = req.params;
  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const sprint = await Sprint.findOne({
    _id: sprintId,
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  })
    .populate("createdBy", "username email image")
    .lean();
  if (!sprint) return next(httpError(404, "Sprint not found"));

  return successResponse({ res, data: sprint });
});

// PATCH /org/:orgId/spaces/:spaceId/sprints/:sprintId
// Edit name/goal/dates. Status changes go through the dedicated
// /sprints/:id/status endpoint so notification fan-out runs.
export const updateSprint = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, sprintId } = req.params;
  const { name, goal, startDate, endDate } = req.body;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const sprint = await Sprint.findOne({
    _id: sprintId,
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  });
  if (!sprint) return next(httpError(404, "Sprint not found"));

  // Resolve effective dates so we validate the FINAL state, not just
  // whichever the caller sent today.
  const effStart = startDate ? new Date(startDate) : sprint.startDate;
  const effEnd = endDate ? new Date(endDate) : sprint.endDate;
  if (effStart && effEnd && effEnd < effStart) {
    return next(httpError(400, "endDate must be after startDate"));
  }

  if (name !== undefined) sprint.name = name;
  if (goal !== undefined) sprint.goal = goal;
  if (startDate !== undefined) sprint.startDate = effStart;
  if (endDate !== undefined) sprint.endDate = effEnd;
  await sprint.save();

  const track = req.logActivity || logActivity;
  await track({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: "Sprint",
    entityId: sprint._id,
    action: "update",
    meta: { fields: Object.keys(req.body || {}) },
  });

  return successResponse({ res, message: "Sprint updated", data: sprint });
});

// DELETE /org/:orgId/spaces/:spaceId/sprints/:sprintId  (soft)
export const deleteSprint = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, sprintId } = req.params;
  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const sprint = await Sprint.findOne({
    _id: sprintId,
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  });
  if (!sprint) return next(httpError(404, "Sprint not found"));

  sprint.isDeleted = true;
  await sprint.save();

  const track = req.logActivity || logActivity;
  await track({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: "Sprint",
    entityId: sprint._id,
    action: "delete",
    meta: { name: sprint.name },
  });

  return successResponse({ res, message: "Sprint deleted" });
});

// POST /org/:orgId/spaces/:spaceId/sprints
export const createSprint = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { name, goal = "", startDate, endDate } = req.body;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  if (new Date(endDate) < new Date(startDate)) {
    return next(httpError(400, "endDate must be after startDate"));
  }

  const sprint = await dbService.create({
    model: Sprint,
    data: {
      name,
      goal,
      organizationId: orgId,
      spaceId,
      startDate,
      endDate,
      status: sprintStatus.Planned,
      createdBy: req.user._id,
      isDeleted: false,
    },
  });

  // ✅ LOG ACTIVITY AFTER SUCCESSFUL CREATE
  const track = req.logActivity || logActivity;
  await track({
    actorId: req.user._id,
    orgId,
    spaceId,
    entityType: "Sprint",
    entityId: sprint._id,
    action: "create",
    meta: {
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    },
  });

  return successResponse({ res, message: "Sprint created", data: sprint }, 201);
});

// PATCH /sprints/:sprintId/status
export const updateSprintStatus = asyncHandler(async (req, res, next) => {
  const { sprintId } = req.params;
  const { status } = req.body;

  const sprint = await dbService.findOne({
    model: Sprint,
    filter: { _id: sprintId, isDeleted: false },
  });
  if (!sprint) return next(httpError(404, "Sprint not found"));

  await requireOrgMember(sprint.organizationId, req.user._id);

  // Optional rule: if setting Active -> close other active in same space
  if (status === sprintStatus.Active) {
    await Sprint.updateMany(
      {
        spaceId: sprint.spaceId,
        organizationId: sprint.organizationId,
        status: sprintStatus.Active,
        isDeleted: false,
        _id: { $ne: sprint._id },
      },
      { status: sprintStatus.Closed }
    );
  }

  const oldStatus = sprint.status;

  const updated = await Sprint.findOneAndUpdate(
    { _id: sprintId, isDeleted: false },
    { status },
    { new: true }
  );

  // ✅ LOG ACTIVITY AFTER STATUS UPDATE
  const track = req.logActivity || logActivity;
  await track({
    actorId: req.user._id,
    orgId: updated.organizationId,
    spaceId: updated.spaceId,
    entityType: "Sprint",
    entityId: updated._id,
    action: "status_change",
    meta: { from: oldStatus, to: status },
  });

  // Notify everyone whose tasks live in this sprint when it starts
  // or closes. The notification.event listeners (sprint_started,
  // sprint_closed) were already wired but had no producer until now.
  if (
    (status === sprintStatus.Active && oldStatus !== sprintStatus.Active) ||
    (status === sprintStatus.Closed && oldStatus !== sprintStatus.Closed)
  ) {
    try {
      const Task = (await import("../../../DB/Model/task.model.js")).default;
      const { notificationEvent } = await import(
        "../../../utils/events/notification.event.js"
      );
      const tasksInSprint = await Task.find({
        sprintId: updated._id,
        isDeleted: false,
      })
        .select("assigneeId reporterId")
        .lean();
      const memberIds = [
        ...new Set(
          tasksInSprint
            .flatMap((t) => [t.assigneeId, t.reporterId])
            .filter(Boolean)
            .map((id) => id.toString()),
        ),
      ].filter((id) => id !== req.user._id.toString());

      if (memberIds.length > 0) {
        notificationEvent.emit(
          status === sprintStatus.Active ? "sprint_started" : "sprint_closed",
          {
            memberIds,
            triggeredById: req.user._id,
            sprintName: updated.name,
            sprintId: updated._id,
          },
        );
      }
    } catch (err) {
      // Notification fan-out failure must never block the status change
      // — `track()` above is already persisted.
    }
  }

  return successResponse({ res, message: "Sprint status updated", data: updated }, 200);
});
