import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import * as dbService from "../../../DB/db.service.js";
import projectModel from "../../../DB/Model/project.model.js";
import teamModel from "../../../DB/Model/team.model.js";
import memberModel, { memberRoles } from "../../../DB/Model/member.model.js";
import { notificationEvent } from "../../../utils/events/notification.event.js";

// ── Shared populate config ────────────────────────────────────
const projectPopulate = [
  { path: "team", select: "name description" },
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

  // 1. Verify requesting user is an active org member
  const membership = await getOrgMembership(req.user._id, orgId);
  if (!membership) {
    return next(
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  // 2. Verify the team exists and belongs to this org
  const team = await dbService.findOne({
    model: teamModel,
    filter: { _id: teamId, isDeleted: false },
  });

  if (!team) {
    return next(new Error("Team not found", { cause: 404 }));
  }

  // 3. Check create permission
  if (!canCreateProject(team, req.user._id, membership)) {
    return next(
      new Error(
        "Only a manager of this team or an org Admin/Owner can create a project",
        { cause: 403 },
      ),
    );
  }

  // 4. ✅ Fix: find + length instead of countDocuments
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
        new Error(
          "One or more members are not active members of this organization",
          { cause: 400 },
        ),
      );
    }
  }

  // 5. Validate dates
  if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
    return next(
      new Error("End date must be after start date", { cause: 400 }),
    );
  }

  // 6. Creator is always a member
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

  // Notify added members (excluding creator)
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
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  const filter = { organizationId: orgId, isDeleted: { $ne: true } };

  // Non-admins only see projects they are a member of
  if (!isOrgAdminOrOwner(membership)) {
    filter.members = req.user._id;
  }

  if (status) filter.status = status;
  if (teamId) filter.team = teamId;
  if (search) filter.$text = { $search: search };

  // ✅ Fix: findAll → find, skip/limit as direct params (no options wrapper)
  const projects = await dbService.find({
    model: projectModel,
    filter,
    populate: [
      { path: "team", select: "name" },
      { path: "manager", select: "username email image" },
      { path: "members", select: "username email image" },
    ],
    skip,
    limit,
  });

  // ✅ Fix: countDocuments removed — use length instead
  const total = projects.length;

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
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: { _id: projectId, organizationId: orgId, isDeleted: { $ne: true } },
    populate: projectPopulate,
  });

  if (!project) {
    return next(new Error("Project not found", { cause: 404 }));
  }

  // Non-admins must be a project member to view details
  const isMember = project.members.some(
    (m) => m._id.toString() === req.user._id.toString(),
  );

  if (!isOrgAdminOrOwner(membership) && !isMember) {
    return next(
      new Error("You do not have access to this project", { cause: 403 }),
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
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: { _id: projectId, organizationId: orgId, isDeleted: { $ne: true } },
  });

  if (!project) {
    return next(new Error("Project not found", { cause: 404 }));
  }

  if (!canManageProject(project, req.user._id, membership)) {
    return next(
      new Error(
        "Only the project manager or org Admin/Owner can update this project",
        { cause: 403 },
      ),
    );
  }

  // Cross-validate dates using existing values as fallback
  const resolvedStart = startDate ? new Date(startDate) : project.startDate;
  const resolvedEnd = endDate ? new Date(endDate) : project.endDate;

  if (resolvedStart && resolvedEnd && resolvedEnd <= resolvedStart) {
    return next(
      new Error("End date must be after start date", { cause: 400 }),
    );
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
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: { _id: projectId, organizationId: orgId, isDeleted: { $ne: true } },
  });

  if (!project) {
    return next(new Error("Project not found", { cause: 404 }));
  }

  if (!canManageProject(project, req.user._id, membership)) {
    return next(
      new Error(
        "Only the project manager or org Admin/Owner can change project status",
        { cause: 403 },
      ),
    );
  }

  if (project.status === status) {
    return next(new Error(`Project is already ${status}`, { cause: 400 }));
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
      new Error(
        "Only org Admins or Owners can transfer the project manager role",
        { cause: 403 },
      ),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: { _id: projectId, organizationId: orgId, isDeleted: { $ne: true } },
  });

  if (!project) {
    return next(new Error("Project not found", { cause: 404 }));
  }

  // New manager must already be a project member
  const isMember = project.members
    .map((m) => m.toString())
    .includes(newManagerId);

  if (!isMember) {
    return next(
      new Error(
        "New manager must already be a member of the project",
        { cause: 400 },
      ),
    );
  }

  if (project.manager.toString() === newManagerId) {
    return next(
      new Error("This user is already the project manager", { cause: 400 }),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: projectModel,
    filter: { _id: projectId },
    data: { manager: newManagerId },
    options: { new: true },
    populate: projectPopulate,
  });

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
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: { _id: projectId, organizationId: orgId, isDeleted: { $ne: true } },
  });

  if (!project) {
    return next(new Error("Project not found", { cause: 404 }));
  }

  if (!canManageProject(project, req.user._id, membership)) {
    return next(
      new Error(
        "Only the project manager or org Admin/Owner can add members",
        { cause: 403 },
      ),
    );
  }

  // Target user must be an active org member
  const targetMembership = await getOrgMembership(memberId, orgId);
  if (!targetMembership) {
    return next(
      new Error(
        "User is not an active member of this organization",
        { cause: 400 },
      ),
    );
  }

  const alreadyMember = project.members
    .map((m) => m.toString())
    .includes(memberId);

  if (alreadyMember) {
    return next(
      new Error("User is already a member of this project", { cause: 409 }),
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
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: { _id: projectId, organizationId: orgId, isDeleted: { $ne: true } },
  });

  if (!project) {
    return next(new Error("Project not found", { cause: 404 }));
  }

  if (!canManageProject(project, req.user._id, membership)) {
    return next(
      new Error(
        "Only the project manager or org Admin/Owner can remove members",
        { cause: 403 },
      ),
    );
  }

  if (project.manager.toString() === memberId) {
    return next(
      new Error(
        "Cannot remove the project manager. Transfer manager role first.",
        { cause: 400 },
      ),
    );
  }

  const isMember = project.members
    .map((m) => m.toString())
    .includes(memberId);

  if (!isMember) {
    return next(
      new Error("User is not a member of this project", { cause: 404 }),
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
      new Error("Only org Admins or Owners can delete projects", { cause: 403 }),
    );
  }

  const project = await dbService.findOne({
    model: projectModel,
    filter: { _id: projectId, organizationId: orgId, isDeleted: { $ne: true } },
  });

  if (!project) {
    return next(new Error("Project not found", { cause: 404 }));
  }

  await dbService.findOneAndUpdate({
    model: projectModel,
    filter: { _id: projectId },
    data: { isDeleted: true, deletedAt: Date.now() },
  });

  return successResponse({ res, message: "Project deleted successfully" });
});