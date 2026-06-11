/**
 * organization/service/invitation.service.js
 *
 * Only handles: POST /org/:orgId/invitations (create/send invite)
 *
 * validate & accept moved to → src/modules/invite/
 */

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
import { httpError } from "../../../utils/errors/index.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const INVITE_EXPIRES_DAYS = 7;

async function requireOrgRole({ orgId, userId, roles }) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member)
    throw httpError(403, "You are not a member of this organization");
  if (!roles.includes(member.role))
    throw httpError(403, "Not authorized");
  return member;
}

// ─────────────────────────────────────────────────────────────
// POST /org/:orgId/invitations — send email invite (owner/admin)
// ─────────────────────────────────────────────────────────────
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
  if (!org) return next(httpError(404, "Organization not found"));

  const normalizedEmail = email.toLowerCase();

  // ── Check if user is already an active member ───────────────
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
        httpError(409, "User is already an active member"),
      );
    }
  }

  // ── Check if there's already a valid pending invitation ─────
  const existingPending = await dbService.findOne({
    model: invitationModel,
    filter: {
      organizationId: orgId,
      email: normalizedEmail,
      status: invitationStatus.Pending,
      expiresAt: { $gt: new Date() },
    },
  });

  if (existingPending) {
    return next(
      httpError(
        409,
        "An active invitation already exists for this email. " +
          "It expires at " +
          existingPending.expiresAt.toISOString(),
      ),
    );
  }

  // ── Revoke any expired/old pending invitations ──────────────
  await invitationModel.updateMany(
    {
      organizationId: orgId,
      email: normalizedEmail,
      status: invitationStatus.Pending,
    },
    { status: invitationStatus.Revoked },
  );

  // ── Create new invitation ───────────────────────────────────
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
