import Sprint, { sprintStatus } from "../../../DB/Model/sprint.model.js";
import Space from "../../../DB/Model/space.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";

// ✅ ADD THIS IMPORT
import { logActivity } from "../../../utils/activity/activity.logger.js";

async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member) throw new Error("Not a member of this organization", { cause: 403 });
  return member;
}

async function requireSpace(spaceId, orgId) {
  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) throw new Error("Space not found", { cause: 404 });
  return space;
}

// POST /org/:orgId/spaces/:spaceId/sprints
export const createSprint = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { name, goal = "", startDate, endDate } = req.body;

  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  if (new Date(endDate) < new Date(startDate)) {
    return next(new Error("endDate must be after startDate", { cause: 400 }));
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
  await logActivity({
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
  if (!sprint) return next(new Error("Sprint not found", { cause: 404 }));

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
  await logActivity({
    actorId: req.user._id,
    orgId: updated.organizationId,
    spaceId: updated.spaceId,
    entityType: "Sprint",
    entityId: updated._id,
    action: "status_change",
    meta: { from: oldStatus, to: status },
  });

  return successResponse({ res, message: "Sprint status updated", data: updated }, 200);
});
