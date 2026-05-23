import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import * as dbService from "../../../DB/db.service.js";
import teamModel from "../../../DB/Model/team.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import userModel, { roleTypes } from "../../../DB/Model/user.model.js";
import { notificationEvent } from "../../../utils/events/notification.event.js";
import { ForbiddenError, NotFoundError } from "../../../utils/errors/index.js";
import { requireOrgAdmin } from "../../../utils/permissions/org.permissions.js";

// ── Shared populate config ────────────────────────────────────
const teamPopulate = [
  { path: "createdBy", select: "username email image" },
  { path: "members", select: "username email image role" },
  { path: "managers", select: "username email image role" },
  { path: "organizationId", select: "name slug" },
];

// ── Helpers ───────────────────────────────────────────────────
// Check if user is team manager OR org admin/owner
async function isTeamManagerOrOrgAdmin(team, userId) {
  const isManager = team.managers
    .map((m) => m.toString())
    .includes(userId.toString());

  if (isManager) return true;

  // Check if org admin/owner
  const orgMembership = await dbService.findOne({
    model: memberModel,
    filter: {
      organizationId: team.organizationId,
      userId,
      isActive: true,
    },
  });

  return orgMembership && ["owner", "admin"].includes(orgMembership.role);
}
// FIX: verify the user is an active member of the team's org
async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member)
    throw new Error("Not a member of this organization", { cause: 403 });
  return member;
}

// ─────────────────────────────────────────────────────────────
// CREATE
// FIX: now requires organizationId and validates members are in the org
// ─────────────────────────────────────────────────────────────
export const createTeam = asyncHandler(async (req, res, next) => {
  const {
    organizationId,
    name,
    description,
    members = [],
    managers = [],
  } = req.body;

  // verify the requesting user is an org member with admin/owner role
  const orgMembership = await requireOrgMember(organizationId, req.user._id);
  if (
    req.user.role !== roleTypes.Admin &&
    !["owner", "admin"].includes(orgMembership.role)
  ) {
    return next(
      new Error("Only org owner/admin or system Admin can create teams", {
        cause: 403,
      }),
    );
  }

  // FIX: validate that all proposed members are active org members
  if (members.length > 0) {
    const validMembers = await dbService.find({
      model: memberModel,
      filter: {
        organizationId,
        userId: { $in: members },
        isActive: true,
      },
    });
    if (validMembers.length !== members.length) {
      return next(
        new Error(
          "One or more members are not active members of this organization",
          { cause: 400 },
        ),
      );
    }
  }

  if (managers.length > 0) {
    const validManagers = await dbService.find({
      model: memberModel,
      filter: {
        organizationId,
        userId: { $in: managers },
        isActive: true,
      },
    });
    if (validManagers.length !== managers.length) {
      return next(
        new Error(
          "One or more managers are not active members of this organization",
          { cause: 400 },
        ),
      );
    }
  }

  const uniqueMembers = [
    ...new Set([
      ...members.map((id) => id.toString()),
      ...managers.map((id) => id.toString()),
      req.user._id.toString(),
    ]),
  ];

  const uniqueManagers = [
    ...new Set([
      ...managers.map((id) => id.toString()),
      req.user._id.toString(),
    ]),
  ];

  const team = await dbService.create({
    model: teamModel,
    data: {
      organizationId, // FIX: stored on the team document
      name,
      description,
      createdBy: req.user._id,
      members: uniqueMembers,
      managers: uniqueManagers,
    },
  });

  const populated = await dbService.findOne({
    model: teamModel,
    filter: { _id: team._id },
    populate: teamPopulate,
  });

  return successResponse({
    res,
    status: 201,
    message: "Team created successfully",
    data: { team: populated },
  });
});

// ─────────────────────────────────────────────────────────────
// LIST
// FIX: supports organizationId filter for "all teams in this org"
// ─────────────────────────────────────────────────────────────
export const listTeams = asyncHandler(async (req, res, next) => {
  const { search, organizationId } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const filter = { isDeleted: { $ne: true } };

  if (organizationId) filter.organizationId = organizationId;

  // Non-admins only see teams they belong to
  if (req.user.role !== roleTypes.Admin) {
    filter.members = req.user._id;
  }

  if (search) {
    filter.$text = { $search: search };
  }

  // FIX: use Promise.all for real total + add sort
  const [teams, total] = await Promise.all([
    teamModel
      .find(filter)
      .populate(teamPopulate)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    teamModel.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: {
      teams,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────
// GET ONE
// ─────────────────────────────────────────────────────────────
export const getTeam = asyncHandler(async (req, res, next) => {
  const { teamId } = req.params;

  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
    populate: teamPopulate,
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  const isMember = team.members.some(
    (m) => m._id.toString() === req.user._id.toString(),
  );

  if (req.user.role !== roleTypes.Admin && !isMember) {
    return next(
      new Error("You do not have access to this team", { cause: 403 }),
    );
  }

  return successResponse({ res, data: { team } });
});

// ─────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────
export const updateTeam = asyncHandler(async (req, res, next) => {
  const { teamId } = req.params;
  const { name, description } = req.body;

  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  if (!(await isTeamManagerOrOrgAdmin(team, req.user._id))) {
    throw new ForbiddenError(
      "Only a team manager or org admin can update team details",
    );
  }

  const updateData = {};
  if (name) updateData.name = name;
  if (description !== undefined) updateData.description = description;

  const updated = await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: updateData,
    options: { new: true },
    populate: teamPopulate,
  });

  return successResponse({
    res,
    message: "Team updated successfully",
    data: { team: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// ADD MEMBER
// FIX: validates the new member is in the same org as the team
// ─────────────────────────────────────────────────────────────
export const addMember = asyncHandler(async (req, res, next) => {
  const { teamId, userId } = req.params;

  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }
  if (!(await isTeamManagerOrOrgAdmin(team, req.user._id))) {
    throw new ForbiddenError(
      "Only a team manager or org admin can update team details",
    );
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: userId, isDeleted: { $ne: true } },
  });

  if (!user) {
    return next(new Error("User not found", { cause: 404 }));
  }

  // FIX: verify the user is a member of the team's organization
  const orgMember = await dbService.findOne({
    model: memberModel,
    filter: {
      organizationId: team.organizationId,
      userId,
      isActive: true,
    },
  });
  if (!orgMember) {
    return next(
      new Error("User is not a member of this team's organization", {
        cause: 400,
      }),
    );
  }

  const alreadyMember = team.members.map((m) => m.toString()).includes(userId);
  if (alreadyMember) {
    return next(
      new Error("User is already a member of this team", { cause: 409 }),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: { $push: { members: userId } },
    options: { new: true },
    populate: teamPopulate,
  });

  notificationEvent.emit("team_member_added", {
    recipientId: userId,
    triggeredById: req.user._id,
    adderName: req.user.username,
    teamName: team.name,
    teamId: team._id,
  });

  return successResponse({
    res,
    message: "Member added successfully",
    data: { team: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// REMOVE MEMBER
// ─────────────────────────────────────────────────────────────
export const removeMember = asyncHandler(async (req, res, next) => {
  const { teamId, userId } = req.params;

  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }
  if (!(await isTeamManagerOrOrgAdmin(team, req.user._id))) {
    throw new ForbiddenError(
      "Only a team manager or org admin can update team details",
    );
  }

  if (team.createdBy.toString() === userId) {
    return next(
      new Error("Cannot remove the team creator. Delete the team instead.", {
        cause: 400,
      }),
    );
  }

  const isMember = team.members.map((m) => m.toString()).includes(userId);
  if (!isMember) {
    return next(new Error("User is not a member of this team", { cause: 404 }));
  }

  const isManager = team.managers.map((m) => m.toString()).includes(userId);

  const pullData = { $pull: { members: userId } };
  if (isManager) {
    if (team.managers.length === 1) {
      return next(
        new Error(
          "Cannot remove the only manager. Promote another member first.",
          { cause: 400 },
        ),
      );
    }
    pullData.$pull.managers = userId;
  }

  const updated = await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: pullData,
    options: { new: true },
    populate: teamPopulate,
  });

  notificationEvent.emit("team_member_removed", {
    recipientId: userId,
    triggeredById: req.user._id,
    teamName: team.name,
    teamId: team._id,
  });

  return successResponse({
    res,
    message: "Member removed successfully",
    data: { team: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// ADD MANAGER
// ─────────────────────────────────────────────────────────────
export const addManager = asyncHandler(async (req, res, next) => {
  const { teamId, userId } = req.params;

  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });
  if (!team) throw new NotFoundError("Team not found");

  // Org owner/admin only (not system Admin)
  await requireOrgAdmin(team.organizationId, req.user._id);

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: userId, isDeleted: { $ne: true } },
  });

  if (!user) {
    return next(new Error("User not found", { cause: 404 }));
  }

  const isMember = team.members.map((m) => m.toString()).includes(userId);
  if (!isMember) {
    return next(
      new Error("User must be a team member before being promoted to manager", {
        cause: 400,
      }),
    );
  }

  const alreadyManager = team.managers
    .map((m) => m.toString())
    .includes(userId);
  if (alreadyManager) {
    return next(
      new Error("User is already a manager of this team", { cause: 409 }),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: { $push: { managers: userId } },
    options: { new: true },
    populate: teamPopulate,
  });

  return successResponse({
    res,
    message: "Member promoted to manager successfully",
    data: { team: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// REMOVE MANAGER
// ─────────────────────────────────────────────────────────────
export const removeManager = asyncHandler(async (req, res, next) => {
  const { teamId, userId } = req.params;

  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });
  if (!team) throw new NotFoundError("Team not found");

  // Org owner/admin only (not system Admin)
  await requireOrgAdmin(team.organizationId, req.user._id);

  if (team.createdBy.toString() === userId) {
    return next(new Error("Cannot demote the team creator", { cause: 400 }));
  }

  const isManager = team.managers.map((m) => m.toString()).includes(userId);
  if (!isManager) {
    return next(
      new Error("User is not a manager of this team", { cause: 404 }),
    );
  }

  if (team.managers.length === 1) {
    return next(
      new Error(
        "Team must have at least one manager. Promote another member first.",
        { cause: 400 },
      ),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: { $pull: { managers: userId } },
    options: { new: true },
    populate: teamPopulate,
  });

  return successResponse({
    res,
    message: "Manager demoted to member successfully",
    data: { team: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// SOFT DELETE
// ─────────────────────────────────────────────────────────────
export const deleteTeam = asyncHandler(async (req, res, next) => {
  const { teamId } = req.params;

  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    throw new NotFoundError("Team not found");
  }

  // Must be org admin or owner of the team's organization
  await requireOrgAdmin(team.organizationId, req.user._id);

  await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: { isDeleted: true, deletedAt: Date.now() },
  });

  return successResponse({ res, message: "Team deleted successfully" });
});
