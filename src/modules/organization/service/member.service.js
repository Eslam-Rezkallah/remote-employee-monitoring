import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";

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
    return next(new Error("Not a member of this organization", { cause: 403 }));

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
    return next(new Error("Cannot change your own role", { cause: 400 }));
  }

  // 2. Check requester is in the org
  const requester = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: req.user._id, isActive: true },
  });
  if (!requester) {
    return next(
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  // 3. Only owner can change roles
  if (requester.role !== "owner") {
    return next(
      new Error("Only the organization owner can change member roles", {
        cause: 403,
      }),
    );
  }

  // 4. Find the target member
  const membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId, isActive: true },
  });
  if (!membership) {
    return next(
      new Error("Member not found in this organization", { cause: 404 }),
    );
  }

  // 5. Can't change the owner's role
  if (membership.role === "owner") {
    return next(new Error("Cannot change the owner role", { cause: 403 }));
  }

  const updated = await dbService.findOneAndUpdate({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId },
    data: { role },
    options: { new: true },
    populate: [{ path: "userId", select: "username email image" }],
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
      new Error(
        "Cannot remove yourself. Use DELETE /org/:orgId/leave instead.",
        { cause: 400 },
      ),
    );
  }

  // 2. Check requester is in the org
  const requester = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: req.user._id, isActive: true },
  });
  if (!requester) {
    return next(
      new Error("You are not a member of this organization", { cause: 403 }),
    );
  }

  // 3. Check requester has permission
  if (!["owner", "admin"].includes(requester.role)) {
    return next(
      new Error("Only owner or admin can remove members", { cause: 403 }),
    );
  }

  // 4. Find the target member
  const membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId, isActive: true },
  });
  if (!membership) {
    return next(
      new Error("Member not found in this organization", { cause: 404 }),
    );
  }

  // 5. Can't remove the owner
  if (membership.role === "owner") {
    return next(
      new Error("Cannot remove the organization owner", { cause: 403 }),
    );
  }

  // Soft deactivate
  await dbService.updateOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId },
    data: { isActive: false },
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
      new Error("You are not a member of this organization", { cause: 404 }),
    );
  }

  if (membership.role === "owner") {
    return next(
      new Error(
        "Owner cannot leave. Transfer ownership or delete the organization.",
        { cause: 400 },
      ),
    );
  }

  await dbService.updateOne({
    model: memberModel,
    filter: { organizationId: orgId, userId },
    data: { isActive: false },
  });

  return successResponse({ res, message: "You have left the organization" });
});
