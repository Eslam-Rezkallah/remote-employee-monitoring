/**
 * modules/invite/service/invite.service.js
 *
 * Handles the public-facing invitation link flow:
 *   GET  /invite/accept?token=  → preview (no auth)
 *   POST /invite/accept         → accept  (auth required)
 */

import crypto from "node:crypto";
import organizationModel from "../../../DB/Model/organization.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import invitationModel, {
  invitationStatus,
} from "../../../DB/Model/invitation.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

// ─────────────────────────────────────────────────────────────
// GET /invite/accept?token=<hex>
// No auth — validates the token and returns invitation details.
// This is the endpoint the email link points to.
// ─────────────────────────────────────────────────────────────
export const previewInvitation = asyncHandler(async (req, res, next) => {
  const { token } = req.query;
  const tokenHash = hashToken(token);

  const invitation = await invitationModel
    .findOne({
      tokenHash,
      status: invitationStatus.Pending,
    })
    .populate("organizationId", "name slug logo isActive isDeleted")
    .populate("invitedBy", "username email image");

  if (!invitation) {
    return next(
      new Error("Invitation not found or already used", { cause: 404 }),
    );
  }

  if (invitation.expiresAt < new Date()) {
    invitation.status = invitationStatus.Expired;
    await invitation.save();
    return next(new Error("Invitation has expired", { cause: 410 }));
  }

  if (
    !invitation.organizationId ||
    invitation.organizationId.isDeleted ||
    !invitation.organizationId.isActive
  ) {
    return next(
      new Error("Organization is no longer available", { cause: 404 }),
    );
  }

  return successResponse({
    res,
    message: "Invitation is valid",
    data: {
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      organization: {
        _id: invitation.organizationId._id,
        name: invitation.organizationId.name,
        slug: invitation.organizationId.slug,
        logo: invitation.organizationId.logo,
      },
      invitedBy: invitation.invitedBy
        ? {
            username: invitation.invitedBy.username,
            image: invitation.invitedBy.image,
          }
        : null,
      status: invitation.status,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /invite/accept  { token }
// Auth required — the logged-in user accepts the invitation.
// ─────────────────────────────────────────────────────────────
export const acceptInvitation = asyncHandler(async (req, res, next) => {
  const { token } = req.body;
  const tokenHash = hashToken(token);

  // 1. Find pending invitation
  const invitation = await invitationModel.findOne({
    tokenHash,
    status: invitationStatus.Pending,
  });

  if (!invitation) {
    return next(
      new Error("Invitation not found or already used", { cause: 404 }),
    );
  }

  // 2. Check expiry
  if (invitation.expiresAt < new Date()) {
    invitation.status = invitationStatus.Expired;
    await invitation.save();
    return next(new Error("Invitation has expired", { cause: 410 }));
  }

  // 3. Email must match the logged-in user
  if (req.user.email.toLowerCase() !== invitation.email) {
    return next(
      new Error(
        "This invitation was sent to a different email address. " +
          `Please log in with ${invitation.email}`,
        { cause: 403 },
      ),
    );
  }

  // 4. Verify organization still exists and is active
  const org = await dbService.findOne({
    model: organizationModel,
    filter: {
      _id: invitation.organizationId,
      isDeleted: false,
      isActive: true,
    },
  });
  if (!org) {
    return next(
      new Error("Organization is no longer available", { cause: 404 }),
    );
  }

  // 5. Check existing membership
  let membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: org._id, userId: req.user._id },
  });

  if (membership?.isActive) {
    // Already a member — just mark invitation as accepted
    invitation.status = invitationStatus.Accepted;
    invitation.acceptedAt = new Date();
    invitation.acceptedBy = req.user._id;
    await invitation.save();

    return successResponse({
      res,
      message: "You are already a member of this organization",
      data: {
        organizationId: org._id,
        organizationName: org.name,
        role: membership.role,
        alreadyMember: true,
      },
    });
  }

  // 6. Create or reactivate membership
  if (!membership) {
    membership = await dbService.create({
      model: memberModel,
      data: {
        organizationId: org._id,
        userId: req.user._id,
        role: invitation.role,
        isActive: true,
      },
    });
  } else {
    // Reactivate deactivated membership
    membership.role = invitation.role;
    membership.isActive = true;
    membership.joinedAt = new Date();
    await membership.save();
  }

  // 7. Mark invitation as accepted
  invitation.status = invitationStatus.Accepted;
  invitation.acceptedAt = new Date();
  invitation.acceptedBy = req.user._id;
  await invitation.save();

  return successResponse({
    res,
    message: "Invitation accepted! You are now a member",
    data: {
      organizationId: org._id,
      organizationName: org.name,
      role: membership.role,
      alreadyMember: false,
    },
  });
});
