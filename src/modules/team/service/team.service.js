import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import * as dbService from "../../../DB/db.service.js";
import teamModel from "../../../DB/Model/team.model.js";
import userModel, { roleTypes } from "../../../DB/Model/user.model.js";
import { notificationEvent } from "../../../utils/events/notification.event.js";

// ── Shared populate config ────────────────────────────────────
const teamPopulate = [
  { path: "createdBy", select: "username email image" },
  { path: "members", select: "username email image role" },
  { path: "managers", select: "username email image role" },
];

// ── Helpers ───────────────────────────────────────────────────
const isManagerOrAdmin = (team, user) =>
  team.managers.map((m) => m.toString()).includes(user._id.toString()) ||
  user.role === roleTypes.Admin;

// ─────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────
export const createTeam = asyncHandler(async (req, res, next) => {
  const { name, description, members = [], managers = [] } = req.body;

  // ✅ Fix: find + length instead of countDocuments
  if (members.length > 0) {
    const validMembers = await dbService.find({
      model: userModel,
      filter: { _id: { $in: members }, isDeleted: { $ne: true } },
    });
    if (validMembers.length !== members.length) {
      return next(
        new Error("One or more member IDs are invalid", { cause: 400 }),
      );
    }
  }

  // ✅ Fix: find + length instead of countDocuments
  if (managers.length > 0) {
    const validManagers = await dbService.find({
      model: userModel,
      filter: { _id: { $in: managers }, isDeleted: { $ne: true } },
    });
    if (validManagers.length !== managers.length) {
      return next(
        new Error("One or more manager IDs are invalid", { cause: 400 }),
      );
    }
  }

  // Managers must also be members — merge both arrays + creator
  const uniqueMembers = [
    ...new Set([
      ...members.map((id) => id.toString()),
      ...managers.map((id) => id.toString()),
      req.user._id.toString(),
    ]),
  ];

  // Creator is always a manager
  const uniqueManagers = [
    ...new Set([
      ...managers.map((id) => id.toString()),
      req.user._id.toString(),
    ]),
  ];

  const team = await dbService.create({
    model: teamModel,
    data: {
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
// ─────────────────────────────────────────────────────────────
export const listTeams = asyncHandler(async (req, res, next) => {
  const { search } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const filter = { isDeleted: { $ne: true } };

  // Non-admins only see teams they belong to
  if (req.user.role !== roleTypes.Admin) {
    filter.members = req.user._id;
  }

  if (search) {
    filter.$text = { $search: search };
  }

  const teams = await dbService.find({
    model: teamModel,
    filter,
    populate: teamPopulate,
    skip,
    limit,
  });

  const total = teams.length;

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

  // Non-admins must be a member to view the team
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

  // ✅ Fix: $ne: true
  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  if (!isManagerOrAdmin(team, req.user)) {
    return next(
      new Error(
        "Only a team manager or Admin can update team details",
        { cause: 403 },
      ),
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
// ─────────────────────────────────────────────────────────────
export const addMember = asyncHandler(async (req, res, next) => {
  const { teamId, userId } = req.params;

  // ✅ Fix: $ne: true
  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  if (!isManagerOrAdmin(team, req.user)) {
    return next(
      new Error("Only a team manager or Admin can add members", { cause: 403 }),
    );
  }

  // ✅ Fix: $ne: true
  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: userId, isDeleted: { $ne: true } },
  });

  if (!user) {
    return next(new Error("User not found", { cause: 404 }));
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

  // ✅ Fix: $ne: true
  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  if (!isManagerOrAdmin(team, req.user)) {
    return next(
      new Error("Only a team manager or Admin can remove members", {
        cause: 403,
      }),
    );
  }

  if (team.createdBy.toString() === userId) {
    return next(
      new Error(
        "Cannot remove the team creator. Delete the team instead.",
        { cause: 400 },
      ),
    );
  }

  const isMember = team.members.map((m) => m.toString()).includes(userId);
  if (!isMember) {
    return next(
      new Error("User is not a member of this team", { cause: 404 }),
    );
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

  if (req.user.role !== roleTypes.Admin) {
    return next(
      new Error("Only an Admin can promote a member to manager", { cause: 403 }),
    );
  }

  // ✅ Fix: $ne: true
  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  // ✅ Fix: $ne: true
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
      new Error(
        "User must be a team member before being promoted to manager",
        { cause: 400 },
      ),
    );
  }

  const alreadyManager = team.managers.map((m) => m.toString()).includes(userId);
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

  if (req.user.role !== roleTypes.Admin) {
    return next(
      new Error("Only an Admin can demote a manager", { cause: 403 }),
    );
  }

  // ✅ Fix: $ne: true
  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  if (team.createdBy.toString() === userId) {
    return next(
      new Error("Cannot demote the team creator", { cause: 400 }),
    );
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

  if (req.user.role !== roleTypes.Admin) {
    return next(
      new Error("Only an Admin can delete a team", { cause: 403 }),
    );
  }

  // ✅ Fix: $ne: true
  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: { $ne: true } },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  await dbService.findOneAndUpdate({
    model: teamModel,
    filter: { _id: teamId },
    data: { isDeleted: true, deletedAt: Date.now() },
  });

  return successResponse({ res, message: "Team deleted successfully" });
});