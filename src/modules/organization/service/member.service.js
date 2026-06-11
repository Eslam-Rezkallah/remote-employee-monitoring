import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { syncOrgChatOnMemberChange } from "../../chatroom/service/chat.sync.service.js";
import { httpError } from "../../../utils/errors/index.js";
import { recordAudit } from "../../../utils/audit/audit.logger.js";
import { auditActions } from "../../../utils/audit/audit.actions.js";

// ─────────────────────────────────────────────────────────────
// GET /org/:orgId/members
// Any active member can view the list.
// Supports ?role=admin|member|owner and ?q=username/email search.
// ─────────────────────────────────────────────────────────────

export const getOrgMembers = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { role, q } = req.query;

  const requester = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: req.user._id, isActive: true },
  });
  if (!requester)
    return next(httpError(403, "Not a member of this organization"));

  const filter = { organizationId: orgId, isActive: true };
  if (role) filter.role = role;

  const { page, limit, skip } = getPagination(req.query);

  const members = await dbService.find({
    model: memberModel,
    filter,
    populate: [{ path: "userId", select: "username email image role" }],
    skip,
    limit,
  });

  // in-memory search by username or email after populate
  const result = q
    ? members.filter((m) => {
        if (!m.userId) return false;
        const term = q.toLowerCase();
        return (
          m.userId.username?.toLowerCase().includes(term) ||
          m.userId.email?.toLowerCase().includes(term)
        );
      })
    : members;

  return successResponse({
    res,
    data: {
      members: result,
      total: result.length,
      page,
      limit,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// PATCH /org/:orgId/members/:memberId/role
// Owner only — promotes or demotes a member.
// ─────────────────────────────────────────────────────────────

export const changeMemberRole = asyncHandler(async (req, res, next) => {
  const { orgId, memberId } = req.params;
  const { role } = req.body;

  // 1. Self check first
  if (memberId === req.user._id.toString()) {
    return next(httpError(400, "Cannot change your own role"));
  }

  // 2. Check requester is in the org
  const requester = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: req.user._id, isActive: true },
  });
  if (!requester) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  // 3. Only owner can change roles
  if (requester.role !== "owner") {
    return next(
      httpError(403, "Only the organization owner can change member roles"),
    );
  }

  // 4. Find the target member
  const membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId, isActive: true },
  });
  if (!membership) {
    return next(
      httpError(404, "Member not found in this organization"),
    );
  }

  // 5. Can't change the owner's role
  if (membership.role === "owner") {
    return next(httpError(403, "Cannot change the owner role"));
  }

  const updated = await dbService.findOneAndUpdate({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId },
    data: { role },
    options: { new: true },
    populate: [{ path: "userId", select: "username email image" }],
  });

  // Reflect the role change in the org-wide chat: admins promoted in
  // the org become admins of the room, demoted ones lose those rights.
  if (["owner", "admin"].includes(role)) {
    syncOrgChatOnMemberChange(orgId, { promoteUserId: memberId });
  } else {
    syncOrgChatOnMemberChange(orgId, { demoteUserId: memberId });
  }

  await recordAudit({
    req,
    actorId: req.user._id,
    orgId,
    action: auditActions.ORG_MEMBER_ROLE_CHANGE,
    targetType: "User",
    targetId: memberId,
    meta: { previousRole: membership.role, newRole: role },
  });

  return successResponse({
    res,
    message: "Member role updated",
    data: { member: updated },
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE /org/:orgId/members/:memberId
// Owner/admin only — removes another member.
// ─────────────────────────────────────────────────────────────

export const removeMember = asyncHandler(async (req, res, next) => {
  const { orgId, memberId } = req.params;

  // 1. Self check first — before any role check
  if (memberId === req.user._id.toString()) {
    return next(
      httpError(400, "Cannot remove yourself. Use DELETE /org/:orgId/leave instead."),
    );
  }

  // 2. Check requester is in the org
  const requester = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: req.user._id, isActive: true },
  });
  if (!requester) {
    return next(
      httpError(403, "You are not a member of this organization"),
    );
  }

  // 3. Check requester has permission
  if (!["owner", "admin"].includes(requester.role)) {
    return next(
      httpError(403, "Only owner or admin can remove members"),
    );
  }

  // 4. Find the target member
  const membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId, isActive: true },
  });
  if (!membership) {
    return next(
      httpError(404, "Member not found in this organization"),
    );
  }

  // 5. Can't remove the owner
  if (membership.role === "owner") {
    return next(
      httpError(403, "Cannot remove the organization owner"),
    );
  }

  // Soft deactivate
  await dbService.updateOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId },
    data: { isActive: false },
  });

  // Drop them from the org-wide chat (and kick their sockets out of it).
  syncOrgChatOnMemberChange(orgId, { removeUserId: memberId });

  await recordAudit({
    req,
    actorId: req.user._id,
    orgId,
    action: auditActions.ORG_MEMBER_REMOVE,
    targetType: "User",
    targetId: memberId,
    meta: { previousRole: membership.role },
  });

  return successResponse({ res, message: "Member removed from organization" });
});

// ─────────────────────────────────────────────────────────────
// DELETE /org/:orgId/leave
// Any member can leave (except the owner).
// ─────────────────────────────────────────────────────────────

export const leaveOrganization = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const userId = req.user._id;

  const membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });

  if (!membership) {
    return next(
      httpError(404, "You are not a member of this organization"),
    );
  }

  if (membership.role === "owner") {
    return next(
      httpError(400, "Owner cannot leave. Transfer ownership or delete the organization."),
    );
  }

  await dbService.updateOne({
    model: memberModel,
    filter: { organizationId: orgId, userId },
    data: { isActive: false },
  });

  // Drop the leaving user from the org-wide chat as well.
  syncOrgChatOnMemberChange(orgId, { removeUserId: userId });

  await recordAudit({
    req,
    actorId: userId,
    orgId,
    action: auditActions.ORG_MEMBER_LEAVE,
    meta: { previousRole: membership.role },
  });

  return successResponse({ res, message: "You have left the organization" });
});
