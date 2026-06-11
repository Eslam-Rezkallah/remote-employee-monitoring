/**
 * ⚠️ DEPRECATED MODULE — kept for backwards compatibility only.
 *
 * The active task hierarchy in this product is:
 *   Organization → Space → Task   (see modules/space + modules/task)
 *
 * The Project module is no longer the canonical container for tasks
 * (the FE is built around Spaces). Do not add new features here.
 * Open issues:
 *   - Project ↔ Space relationship is undefined
 *   - Tasks don't reference projectId; they reference spaceId
 *
 * Migration plan (future):
 *   - Either drop the Project module entirely once analytics confirm
 *     no live clients call its endpoints,
 *   - OR add `Space.projectId` to bridge the two trees.
 */
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import * as dbService from "../../../DB/db.service.js";
import projectModel from "../../../DB/Model/project.model.js";
import teamModel from "../../../DB/Model/team.model.js";
import memberModel, { memberRoles } from "../../../DB/Model/member.model.js";
import { notificationEvent } from "../../../utils/events/notification.event.js";
import { syncProjectChannelMembership } from "../../chatroom/service/chat.sync.service.js";
import { httpError } from "../../../utils/errors/index.js";

// ── Shared populate config ────────────────────────────────────
const projectPopulate = [
  { path: "team", select: "name description organizationId" },
  { path: "manager", select: "username email image" },
  { path: "members", select: "username email image" },
  { path: "tasks", select: "title status priority dueDate assigneeId" },
];

// ─────────────────────────────────────────────────────────────
// Permission Helpers
// ─────────────────────────────────────────────────────────────

const getOrgMembership = (userId, orgId) =>
  dbService.findOne({
    model: memberModel,
    filter: { userId, organizationId: orgId, isActive: true },
  });

const isOrgAdminOrOwner = (membership) =>
  membership &&
  [memberRoles.Admin, memberRoles.Owner].includes(membership.role);

const canManageProject = (project, userId, membership) =>
  project.manager.toString() === userId.toString() ||
  isOrgAdminOrOwner(membership);

const canCreateProject = (team, userId, membership) =>
  team.managers.map((m) => m.toString()).includes(userId.toString()) ||
  isOrgAdminOrOwner(membership);

// ─────────────────────────────────────────────────────────────
// CREATE
// FIX: team filter now includes organizationId to prevent
//      cross-org team references
// ─────────────────────────────────────────────────────────────
export const createProject = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const {
    title,
    description,
    status,
    startDate,
    endDate,
    teamId,
    members = [],
  } = req.body;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!membership) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  // FIX: verify team exists AND belongs to THIS org
  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, organizationId: orgId, isDeleted: false },
  });

  if (!team) {
    return next(
      httpError(404, "Team not found in this organization"),
    );
  }

  if (!canCreateProject(team, req.user._id, membership)) {
    return next(
      httpError(403, "Only a manager of this team or an org Admin/Owner can create a project"),
    );
  }

  if (members.length > 0) {
    const validMembers = await dbService.find({
      model: memberModel,
      filter: {
        userId: { $in: members },
        organizationId: orgId,
        isActive: true,
      },
    });

    if (validMembers.length !== members.length) {
      return next(
        httpError(400, "One or more members are not active members of this organization"),
      );
    }
  }

  if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
    return next(httpError(400, "End date must be after start date"));
  }

  const uniqueMembers = [
    ...new Set([
      ...members.map((id) => id.toString()),
      req.user._id.toString(),
    ]),
  ];

  const project = await dbService.create({
    model: projectModel,
    data: {
      title,
      description,
      status: status || "Active",
      startDate: startDate || null,
      endDate: endDate || null,
      organizationId: orgId,
      team: teamId,
      manager: req.user._id,
      members: uniqueMembers,
    },
  });

  const populated = await dbService.findOne({
    model: projectModel,
    filter: { _id: project._id },
    populate: projectPopulate,
  });

  const otherMembers = uniqueMembers.filter(
    (id) => id !== req.user._id.toString(),
  );

  otherMembers.forEach((memberId) => {
    notificationEvent.emit("project_member_added", {
      recipientId: memberId,
      triggeredById: req.user._id,
      adderName: req.user.username,
      projectName: title,
      projectId: project._id,
    });
  });

  return successResponse({
    res,
    status: 201,
    message: "Project created successfully",
    data: { project: populated },
  });
});

// ─────────────────────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────────────────────
export const listProjects = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { status, search, teamId } = req.query;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!membership) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  const filter = { organizationId: orgId, isDeleted: { $ne: true } };

  if (!isOrgAdminOrOwner(membership)) {
    filter.members = req.user._id;
  }

  if (status) filter.status = status;
  if (teamId) filter.team = teamId;
  if (search) filter.$text = { $search: search };

  // FIX: previous code returned `total = projects.length` which is just
  // the current page size — clients couldn't compute correct page counts.
  // Use a real countDocuments alongside the page query.
  const [projects, total] = await Promise.all([
    dbService.find({
      model: projectModel,
      filter,
      populate: [
        { path: "team", select: "name" },
        { path: "manager", select: "username email image" },
        { path: "members", select: "username email image" },
      ],
      skip,
      limit,
    }),
    dbService.countDocuments({ model: projectModel, filter }),
  ]);

  return successResponse({
    res,
    data: {
      projects,
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
export const getProject = asyncHandler(async (req, res, next) => {
  const { orgId, projectId } = req.params;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!membership) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: {
      _id: projectId,
      organizationId: orgId,
      isDeleted: { $ne: true },
    },
    populate: projectPopulate,
  });

  if (!project) {
    return next(httpError(404, "Project not found"));
  }

  const isMember = project.members.some(
    (m) => m._id.toString() === req.user._id.toString(),
  );

  if (!isOrgAdminOrOwner(membership) && !isMember) {
    return next(
      httpError(403, "You do not have access to this project"),
    );
  }

  return successResponse({ res, data: { project } });
});

// ─────────────────────────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────────────────────────
export const updateProject = asyncHandler(async (req, res, next) => {
  const { orgId, projectId } = req.params;
  const { title, description, startDate, endDate } = req.body;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!membership) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: {
      _id: projectId,
      organizationId: orgId,
      isDeleted: { $ne: true },
    },
  });

  if (!project) {
    return next(httpError(404, "Project not found"));
  }

  if (!canManageProject(project, req.user._id, membership)) {
    return next(
      httpError(403, "Only the project manager or org Admin/Owner can update this project"),
    );
  }

  const resolvedStart = startDate ? new Date(startDate) : project.startDate;
  const resolvedEnd = endDate ? new Date(endDate) : project.endDate;

  if (resolvedStart && resolvedEnd && resolvedEnd <= resolvedStart) {
    return next(httpError(400, "End date must be after start date"));
  }

  const updateData = {};
  if (title) updateData.title = title;
  if (description !== undefined) updateData.description = description;
  if (startDate) updateData.startDate = startDate;
  if (endDate) updateData.endDate = endDate;

  const updated = await dbService.findOneAndUpdate({
    model: projectModel,
    filter: { _id: projectId },
    data: updateData,
    options: { new: true },
    populate: projectPopulate,
  });

  return successResponse({
    res,
    message: "Project updated successfully",
    data: { project: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// UPDATE STATUS
// ─────────────────────────────────────────────────────────────
export const updateProjectStatus = asyncHandler(async (req, res, next) => {
  const { orgId, projectId } = req.params;
  const { status } = req.body;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!membership) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: {
      _id: projectId,
      organizationId: orgId,
      isDeleted: { $ne: true },
    },
  });

  if (!project) {
    return next(httpError(404, "Project not found"));
  }

  if (!canManageProject(project, req.user._id, membership)) {
    return next(
      httpError(403, "Only the project manager or org Admin/Owner can change project status"),
    );
  }

  if (project.status === status) {
    return next(httpError(400, `Project is already ${status}`));
  }

  const updated = await dbService.findOneAndUpdate({
    model: projectModel,
    filter: { _id: projectId },
    data: { status },
    options: { new: true },
    populate: projectPopulate,
  });

  return successResponse({
    res,
    message: `Project status updated to ${status}`,
    data: { project: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// TRANSFER MANAGER
// ─────────────────────────────────────────────────────────────
export const transferManager = asyncHandler(async (req, res, next) => {
  const { orgId, projectId } = req.params;
  const { newManagerId } = req.body;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!isOrgAdminOrOwner(membership)) {
    return next(
      httpError(403, "Only org Admins or Owners can transfer the project manager role"),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: {
      _id: projectId,
      organizationId: orgId,
      isDeleted: { $ne: true },
    },
  });

  if (!project) {
    return next(httpError(404, "Project not found"));
  }

  const isMember = project.members
    .map((m) => m.toString())
    .includes(newManagerId);

  if (!isMember) {
    return next(
      httpError(400, "New manager must already be a member of the project"),
    );
  }

  if (project.manager.toString() === newManagerId) {
    return next(
      httpError(400, "This user is already the project manager"),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: projectModel,
    filter: { _id: projectId },
    data: { manager: newManagerId },
    options: { new: true },
    populate: projectPopulate,
  });

  // New manager must become admin of the project channels.
  syncProjectChannelMembership(project._id);

  return successResponse({
    res,
    message: "Project manager transferred successfully",
    data: { project: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// ADD MEMBER
// ─────────────────────────────────────────────────────────────
export const addMember = asyncHandler(async (req, res, next) => {
  const { orgId, projectId, memberId } = req.params;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!membership) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: {
      _id: projectId,
      organizationId: orgId,
      isDeleted: { $ne: true },
    },
  });

  if (!project) {
    return next(httpError(404, "Project not found"));
  }

  if (!canManageProject(project, req.user._id, membership)) {
    return next(
      httpError(403, "Only the project manager or org Admin/Owner can add members"),
    );
  }

  const targetMembership = await getOrgMembership(memberId, orgId);
  if (!targetMembership) {
    return next(
      httpError(400, "User is not an active member of this organization"),
    );
  }

  const alreadyMember = project.members
    .map((m) => m.toString())
    .includes(memberId);

  if (alreadyMember) {
    return next(
      httpError(409, "User is already a member of this project"),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: projectModel,
    filter: { _id: projectId },
    data: { $push: { members: memberId } },
    options: { new: true },
    populate: projectPopulate,
  });

  notificationEvent.emit("project_member_added", {
    recipientId: memberId,
    triggeredById: req.user._id,
    adderName: req.user.username,
    projectName: project.title,
    projectId: project._id,
  });

  // Sync project-scoped channels so the new member appears in them.
  syncProjectChannelMembership(project._id);

  return successResponse({
    res,
    message: "Member added successfully",
    data: { project: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// REMOVE MEMBER
// ─────────────────────────────────────────────────────────────
export const removeMember = asyncHandler(async (req, res, next) => {
  const { orgId, projectId, memberId } = req.params;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!membership) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: {
      _id: projectId,
      organizationId: orgId,
      isDeleted: { $ne: true },
    },
  });

  if (!project) {
    return next(httpError(404, "Project not found"));
  }

  if (!canManageProject(project, req.user._id, membership)) {
    return next(
      httpError(403, "Only the project manager or org Admin/Owner can remove members"),
    );
  }

  if (project.manager.toString() === memberId) {
    return next(
      httpError(400, "Cannot remove the project manager. Transfer manager role first."),
    );
  }

  const isMember = project.members.map((m) => m.toString()).includes(memberId);

  if (!isMember) {
    return next(
      httpError(404, "User is not a member of this project"),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: projectModel,
    filter: { _id: projectId },
    data: { $pull: { members: memberId } },
    options: { new: true },
    populate: projectPopulate,
  });

  notificationEvent.emit("project_member_removed", {
    recipientId: memberId,
    triggeredById: req.user._id,
    projectName: project.title,
    projectId: project._id,
  });

  // Drop the removed member from project channels + kick their sockets.
  syncProjectChannelMembership(project._id);

  return successResponse({
    res,
    message: "Member removed successfully",
    data: { project: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// SOFT DELETE
// ─────────────────────────────────────────────────────────────
export const deleteProject = asyncHandler(async (req, res, next) => {
  const { orgId, projectId } = req.params;

  const membership = await getOrgMembership(req.user._id, orgId);
  if (!isOrgAdminOrOwner(membership)) {
    return next(
      httpError(403, "Only org Admins or Owners can delete projects"),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: {
      _id: projectId,
      organizationId: orgId,
      isDeleted: { $ne: true },
    },
  });

  if (!project) {
    return next(httpError(404, "Project not found"));
  }

  await dbService.findOneAndUpdate({
    model: projectModel,
    filter: { _id: projectId },
    data: { isDeleted: true, deletedAt: Date.now() },
  });

  return successResponse({ res, message: "Project deleted successfully" });
});
