import memberModel from "../../../DB/Model/member.model.js";
import organizationModel from "../../../DB/Model/organization.model.js";
import userModel from "../../../DB/Model/user.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { requireOrgRole } from "./organization.service.js";

// ─────────────────────────────────────────────────────────────
// GET /org/:orgId/members
// Any active member can view the list.
// Supports ?role=admin|member|owner and ?q=username/email search.
// ─────────────────────────────────────────────────────────────

export const getOrgMembers = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { role, q } = req.query;

  // any active member can view the member list
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
// Promotes or demotes a member. Owner only.
// Cannot change another owner's role or your own.
// ─────────────────────────────────────────────────────────────

export const changeMemberRole = asyncHandler(async (req, res, next) => {
  const { orgId, memberId } = req.params;
  const { role } = req.body;

  // only the org owner can promote/demote
  await requireOrgRole({ orgId, userId: req.user._id, roles: ["owner"] });

  // cannot change your own role
  if (memberId === req.user._id.toString()) {
    return next(new Error("Cannot change your own role", { cause: 400 }));
  }

  const membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId, isActive: true },
  });
  if (!membership)
    return next(new Error("Member not found in this organization", { cause: 404 }));

  // cannot demote another owner
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
// Removes a member from the org. Owner/admin only.
// Cannot remove the owner. Also removes their username from
// the org.members array (kept for legacy join code flow).
// ─────────────────────────────────────────────────────────────

export const removeMember = asyncHandler(async (req, res, next) => {
  const { orgId, memberId } = req.params;

  await requireOrgRole({ orgId, userId: req.user._id, roles: ["owner", "admin"] });

  // cannot remove yourself via this endpoint
  if (memberId === req.user._id.toString()) {
    return next(
      new Error("Cannot remove yourself. Leave the organization instead.", { cause: 400 })
    );
  }

  const membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId, isActive: true },
  });
  if (!membership)
    return next(new Error("Member not found in this organization", { cause: 404 }));

  // cannot remove the org owner
  if (membership.role === "owner") {
    return next(new Error("Cannot remove the organization owner", { cause: 403 }));
  }

  // soft deactivate the membership record
  await dbService.updateOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: memberId },
    data: { isActive: false },
  });

  // also remove their username from the org.members string array
  const removedUser = await dbService.findOne({
    model: userModel,
    filter: { _id: memberId },
    select: "username",
  });

  if (removedUser?.username) {
    await dbService.updateOne({
      model: organizationModel,
      filter: { _id: orgId },
      data: { $pull: { members: removedUser.username } },
    });
  }

  return successResponse({ res, message: "Member removed from organization" });
});
