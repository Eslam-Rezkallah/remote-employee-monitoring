import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import * as dbService from "../../../DB/db.service.js";
import teamModel from "../../../DB/Model/team.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import userModel, { roleTypes } from "../../../DB/Model/user.model.js";
import { notificationEvent } from "../../../utils/events/notification.event.js";
import { ForbiddenError, NotFoundError, httpError } from "../../../utils/errors/index.js";
import {
  requireOrgAdmin,
  requireOrgMember,
} from "../../../utils/permissions/org.permissions.js";
import { syncTeamChatMembership } from "../../chatroom/service/chat.sync.service.js";
import { recordAudit } from "../../../utils/audit/audit.logger.js";
import { auditActions } from "../../../utils/audit/audit.actions.js";

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
// Note: `requireOrgMember` is imported from utils/permissions/org.permissions.js
// at the top of the file. The local copy that used to live here was removed
// to eliminate divergent implementations.

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
      httpError(403, "Only org owner/admin or system Admin can create teams"),
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
        httpError(400, "One or more members are not active members of this organization"),
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
        httpError(400, "One or more managers are not active members of this organization"),
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
    return next(httpError(404, "Team not found"));
  }

  const isMember = team.members.some(
    (m) => m._id.toString() === req.user._id.toString(),
  );

  if (req.user.role !== roleTypes.Admin && !isMember) {
    return next(
      httpError(403, "You do not have access to this team"),
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
    return next(httpError(404, "Team not found"));
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
    return next(httpError(404, "Team not found"));
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
    return next(httpError(404, "User not found"));
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
      httpError(400, "User is not a member of this team's organization"),
    );
  }

  const alreadyMember = team.members.map((m) => m.toString()).includes(userId);
  if (alreadyMember) {
    return next(
      httpError(409, "User is already a member of this team"),
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

  // Sync the auto-created team chat room (if any) so the new member
  // appears in the team's chat without a manual addMember call.
  // Errors are logged inside, never thrown — team add succeeds either way.
  syncTeamChatMembership(team._id);

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
    return next(httpError(404, "Team not found"));
  }
  if (!(await isTeamManagerOrOrgAdmin(team, req.user._id))) {
    throw new ForbiddenError(
      "Only a team manager or org admin can update team details",
    );
  }

  if (team.createdBy.toString() === userId) {
    return next(
      httpError(400, "Cannot remove the team creator. Delete the team instead."),
    );
  }

  const isMember = team.members.map((m) => m.toString()).includes(userId);
  if (!isMember) {
    return next(httpError(404, "User is not a member of this team"));
  }

  const isManager = team.managers.map((m) => m.toString()).includes(userId);

  const pullData = { $pull: { members: userId } };
  if (isManager) {
    if (team.managers.length === 1) {
      return next(
        httpError(400, "Cannot remove the only manager. Promote another member first."),
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

  // Sync the team chat so the removed member is also dropped from it.
  // Their open sockets in the room get evicted inside the helper.
  syncTeamChatMembership(team._id);

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

  // FIX: was org-admin/owner ONLY, which was inconsistent with
  // addMember/removeMember (team manager allowed). Slack/Teams
  // convention: a team manager can promote their own members.
  // Org admin/owner still allowed via the shared helper.
  if (!(await isTeamManagerOrOrgAdmin(team, req.user._id))) {
    throw new ForbiddenError(
      "Only a team manager or org admin/owner can promote a member to manager",
    );
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: userId, isDeleted: { $ne: true } },
  });

  if (!user) {
    return next(httpError(404, "User not found"));
  }

  const isMember = team.members.map((m) => m.toString()).includes(userId);
  if (!isMember) {
    return next(
      httpError(400, "User must be a team member before being promoted to manager"),
    );
  }

  const alreadyManager = team.managers
    .map((m) => m.toString())
    .includes(userId);
  if (alreadyManager) {
    return next(
      httpError(409, "User is already a manager of this team"),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: { $push: { managers: userId } },
    options: { new: true },
    populate: teamPopulate,
  });

  // New manager should become an admin of the team chat too.
  syncTeamChatMembership(team._id);

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
    return next(httpError(400, "Cannot demote the team creator"));
  }

  const isManager = team.managers.map((m) => m.toString()).includes(userId);
  if (!isManager) {
    return next(
      httpError(404, "User is not a manager of this team"),
    );
  }

  if (team.managers.length === 1) {
    return next(
      httpError(400, "Team must have at least one manager. Promote another member first."),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: { $pull: { managers: userId } },
    options: { new: true },
    populate: teamPopulate,
  });

  // Demoted manager should lose team-chat admin powers.
  syncTeamChatMembership(team._id);

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

  await recordAudit({
    req,
    actorId: req.user._id,
    orgId: team.organizationId,
    action: auditActions.TEAM_DELETE,
    targetType: "Team",
    targetId: team._id,
    meta: { name: team.name, members: team.members?.length || 0 },
  });

  return successResponse({ res, message: "Team deleted successfully" });
});
