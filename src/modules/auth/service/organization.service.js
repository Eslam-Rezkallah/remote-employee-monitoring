// src/modules/auth/service/organization.service.js
//
// Handles org JOIN by code only (no login required — authenticates via email+password).
// Org creation lives in: src/modules/organization/service/organization.service.js
import * as dbService from "../../../DB/db.service.js";
import organizationModel from "../../../DB/Model/organization.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import userModel from "../../../DB/Model/user.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { compareHash } from "../../../utils/security/hash.security.js";

// ─────────────────────────────────────────────────────────────
// joinOrganization — business logic
// ─────────────────────────────────────────────────────────────

export const joinOrganization = async ({ email, password, joinCode }) => {
  const user = await dbService.findOne({
    model: userModel,
    filter: { email },
  });
  if (!user) {
    throw new Error("Invalid email or password", { cause: 401 });
  }

  if (user.provider !== "System") {
    throw new Error(
      "This account uses social login. Please use your provider to sign in.",
      { cause: 401 },
    );
  }

  const isPasswordValid = compareHash({
    plainText: password,
    hashValue: user.password,
  });
  if (!isPasswordValid) {
    throw new Error("Invalid email or password", { cause: 401 });
  }

  if (!user.confirmEmail) {
    throw new Error("Please verify your email first", { cause: 403 });
  }

  const organization = await dbService.findOne({
    model: organizationModel,
    filter: {
      joinCode: joinCode.toUpperCase(),
      isDeleted: false,
      isActive: true,
    },
  });
  if (!organization) {
    throw new Error("Invalid organization code", { cause: 404 });
  }

  const existingMembership = await dbService.findOne({
    model: memberModel,
    filter: {
      organizationId: organization._id,
      userId: user._id,
    },
  });

  if (existingMembership) {
    if (existingMembership.isActive) {
      throw new Error("You are already a member of this organization", {
        cause: 409,
      });
    }

    // reactivate deactivated membership
    existingMembership.isActive = true;
    existingMembership.joinedAt = Date.now();
    await existingMembership.save();

    return {
      organization,
      membership: existingMembership,
      message: "Membership reactivated successfully",
    };
  }

  const membership = await dbService.create({
    model: memberModel,
    data: {
      organizationId: organization._id,
      userId: user._id,
      role: "member",
      isActive: true,
    },
  });

  return { organization, membership };
};

// ─────────────────────────────────────────────────────────────
// POST /auth/org-join  — controller
// ─────────────────────────────────────────────────────────────

export const joinOrganizationController = asyncHandler(
  async (req, res, next) => {
    const { email, password, joinCode } = req.body;

    const result = await joinOrganization({ email, password, joinCode });

return successResponse(
  {
    res,
    message: result.message || "Successfully joined organization",
    data: result,
  },
  201,
);
  },
);
