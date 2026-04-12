// src/modules/auth/service/organization.service.js
//
// Handles org ONBOARDING only (create on signup / join by code).
// Full org management (CRUD, members, etc.) lives in:
//   src/modules/organization/service/organization.service.js

import organizationModel from "../../../DB/Model/organization.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import userModel from "../../../DB/Model/user.model.js";
import { nanoid } from "nanoid";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { compareHash } from "../../../utils/security/hash.security.js";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const generateUniqueJoinCode = async () => {
  while (true) {
    const raw = nanoid(12)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    const code = raw.substring(0, 8);
    if (code.length < 8) continue; // retry if stripping reduced length
    const existing = await organizationModel.findOne({ joinCode: code });
    if (!existing) return code;
  }
};

// ─────────────────────────────────────────────────────────────
// createOrganization — business logic (reusable)
// ─────────────────────────────────────────────────────────────

export const createOrganization = async ({ name, slug, logo, ownerId }) => {
  const baseSlug =
    slug ||
    `${name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")}-${nanoid(6)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")}`;

  const existingOrg = await organizationModel.findOne({ slug: baseSlug });
  if (existingOrg) {
    throw new Error("Organization slug already exists", { cause: 409 });
  }

  const owner = await userModel.findById(ownerId);
  if (!owner) {
    throw new Error("Owner user not found", { cause: 404 });
  }

  const joinCode = await generateUniqueJoinCode();

  const organization = await organizationModel.create({
    name,
    slug: baseSlug,
    logo: logo || null,
    joinCode,
    ownerId,
    members: [owner.username],
    isActive: true,
    isDeleted: false,
  });

  const membership = await memberModel.create({
    organizationId: organization._id,
    userId: ownerId,
    role: "owner",
    isActive: true,
  });

  return { organization, membership };
};

// ─────────────────────────────────────────────────────────────
// POST /auth/org-create  — controller
// FIX: ownerId now comes from req.user._id (token), NOT req.body
// ─────────────────────────────────────────────────────────────

export const createOrganizationController = asyncHandler(
  async (req, res, next) => {
    const { name, slug, logo } = req.body;
    const ownerId = req.user._id; // ← secured: from JWT, not body

    const result = await createOrganization({ name, slug, logo, ownerId });

    return successResponse({
      res,
      message: "Organization created successfully",
      data: result,
      status: 201,
    });
  },
);

// ─────────────────────────────────────────────────────────────
// joinOrganization — business logic
// FIX: checks provider before calling compareHash
//      Google/Github users have no password — would crash otherwise
// ─────────────────────────────────────────────────────────────

export const joinOrganization = async ({ email, password, joinCode }) => {
  const user = await userModel.findOne({ email });
  if (!user) {
    throw new Error("Invalid email or password", { cause: 401 });
  }

  // FIX: social login users cannot join via password
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

  const organization = await organizationModel.findOne({
    joinCode: joinCode.toUpperCase(),
    isDeleted: false,
    isActive: true,
  });
  if (!organization) {
    throw new Error("Invalid organization code", { cause: 404 });
  }

  const existingMembership = await memberModel.findOne({
    organizationId: organization._id,
    userId: user._id,
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

    if (!organization.members.includes(user.username)) {
      organization.members.push(user.username);
      await organization.save();
    }

    return {
      organization,
      membership: existingMembership,
      message: "Membership reactivated successfully",
    };
  }

  const membership = await memberModel.create({
    organizationId: organization._id,
    userId: user._id,
    role: "member",
    isActive: true,
  });

  organization.members.push(user.username);
  await organization.save();

  return { organization, membership };
};

// ─────────────────────────────────────────────────────────────
// POST /auth/org-join  — controller
// ─────────────────────────────────────────────────────────────

export const joinOrganizationController = asyncHandler(
  async (req, res, next) => {
    const { email, password, joinCode } = req.body;

    const result = await joinOrganization({ email, password, joinCode });

    return successResponse({
      res,
      message: result.message || "Successfully joined organization",
      data: result,
      status: 201,
    });
  },
);
