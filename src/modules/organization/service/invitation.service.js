import crypto from "node:crypto";
import organizationModel from "../../../DB/Model/organization.model.js";
import memberModel, { memberRoles } from "../../../DB/Model/member.model.js";
import invitationModel, {
  invitationStatus,
} from "../../../DB/Model/invitation.model.js";
import userModel from "../../../DB/Model/user.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { sendOrganizationInvitationEmail } from "../../../utils/email/invitation.email.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const INVITE_EXPIRES_DAYS = 7;

async function requireOrgRole({ orgId, userId, roles }) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member)
    throw new Error("You are not a member of this organization", {
      cause: 403,
    });
  if (!roles.includes(member.role))
    throw new Error("Not authorized", { cause: 403 });
  return member;
}

export const createInvitation = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { email, role = memberRoles.Member } = req.body;

  await requireOrgRole({
    orgId,
    userId: req.user._id,
    roles: [memberRoles.Owner, memberRoles.Admin],
  });

  const org = await dbService.findOne({
    model: organizationModel,
    filter: { _id: orgId, isDeleted: false, isActive: true },
  });
  if (!org) return next(new Error("Organization not found", { cause: 404 }));

  const normalizedEmail = email.toLowerCase();

  const invitedUser = await dbService.findOne({
    model: userModel,
    filter: { email: normalizedEmail, isDeleted: false },
  });
  if (invitedUser) {
    const activeMembership = await dbService.findOne({
      model: memberModel,
      filter: {
        organizationId: orgId,
        userId: invitedUser._id,
        isActive: true,
      },
    });
    if (activeMembership) {
      return next(
        new Error("User is already an active member", { cause: 409 }),
      );
    }
  }

  await invitationModel.updateMany(
    {
      organizationId: orgId,
      email: normalizedEmail,
      status: invitationStatus.Pending,
    },
    { status: invitationStatus.Revoked },
  );

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(
    Date.now() + INVITE_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
  );

  const invitation = await dbService.create({
    model: invitationModel,
    data: {
      organizationId: orgId,
      email: normalizedEmail,
      role,
      tokenHash,
      invitedBy: req.user._id,
      expiresAt,
      status: invitationStatus.Pending,
    },
  });

  const invitationLink = `${
    process.env.FRONTEND_URL || "http://localhost:3000"
  }/invite/accept?token=${token}`;

  await sendOrganizationInvitationEmail({
    to: normalizedEmail,
    orgName: org.name,
    role,
    invitationLink,
    expiresAt: expiresAt.toISOString(),
  });

  return successResponse({
    res,
    message: "Invitation created and email sent",
    data: {
      invitationId: invitation._id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    },
  });
});

export const validateInvitation = asyncHandler(async (req, res, next) => {
  const { token } = req.query;
  const tokenHash = hashToken(token);

  const invitation = await invitationModel
    .findOne({
      tokenHash,
      status: invitationStatus.Pending,
    })
    .populate("organizationId", "name slug logo isActive isDeleted");

  if (!invitation) {
    return next(
      new Error("Invitation not found or already used", { cause: 404 }),
    );
  }

  if (invitation.expiresAt < new Date()) {
    invitation.status = invitationStatus.Expired;
    await invitation.save();
    return next(new Error("Invitation expired", { cause: 410 }));
  }

  if (
    !invitation.organizationId ||
    invitation.organizationId.isDeleted ||
    !invitation.organizationId.isActive
  ) {
    return next(new Error("Organization is not available", { cause: 404 }));
  }

  return successResponse({
    res,
    data: {
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      organization: invitation.organizationId,
      status: invitation.status,
    },
  });
});

export const acceptInvitation = asyncHandler(async (req, res, next) => {
  const { token } = req.body;
  const tokenHash = hashToken(token);

  const invitation = await invitationModel.findOne({
    tokenHash,
    status: invitationStatus.Pending,
  });

  if (!invitation) {
    return next(
      new Error("Invitation not found or already used", { cause: 404 }),
    );
  }

  if (invitation.expiresAt < new Date()) {
    invitation.status = invitationStatus.Expired;
    await invitation.save();
    return next(new Error("Invitation expired", { cause: 410 }));
  }

  if (req.user.email.toLowerCase() !== invitation.email) {
    return next(
      new Error("This invitation belongs to another email", { cause: 403 }),
    );
  }

  const org = await dbService.findOne({
    model: organizationModel,
    filter: {
      _id: invitation.organizationId,
      isDeleted: false,
      isActive: true,
    },
  });
  if (!org) return next(new Error("Organization not found", { cause: 404 }));

  let membership = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: org._id, userId: req.user._id },
  });

  if (membership?.isActive) {
    invitation.status = invitationStatus.Accepted;
    invitation.acceptedAt = new Date();
    invitation.acceptedBy = req.user._id;
    await invitation.save();
    return successResponse({
      res,
      message: "User is already a member. Invitation marked as accepted",
      data: { organizationId: org._id, role: membership.role },
    });
  }

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
    membership.role = invitation.role;
    membership.isActive = true;
    membership.joinedAt = new Date();
    await membership.save();
  }

  // FIX: removed `org.members.push(req.user.username); await org.save();`
  //      Membership is tracked via the Member collection exclusively.

  invitation.status = invitationStatus.Accepted;
  invitation.acceptedAt = new Date();
  invitation.acceptedBy = req.user._id;
  await invitation.save();

  return successResponse({
    res,
    message: "Invitation accepted",
    data: {
      organizationId: org._id,
      role: membership.role,
    },
  });
});
