import organizationModel from "../../../DB/Model/organization.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import userModel from "../../../DB/Model/user.model.js";
import { nanoid } from "nanoid";
import asyncHandler from "express-async-handler";
import { successResponse } from "../../../utils/response/success.response.js";
import { compareHash } from "../../../utils/security/hash.security.js";

/**
 * Generate a unique 8-character join code for organization
 * @returns {Promise<string>} Unique join code
 */
const generateUniqueJoinCode = async () => {
  let joinCode;
  let isUnique = false;
  
  while (!isUnique) {
    // Generate 8-character alphanumeric code (uppercase)
    joinCode = nanoid(8).toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Ensure it's exactly 8 characters
    while (joinCode.length < 8) {
      joinCode += nanoid(1).toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    joinCode = joinCode.substring(0, 8);
    
    // Check if code already exists
    const existing = await organizationModel.findOne({ joinCode });
    if (!existing) {
      isUnique = true;
    }
  }
  
  return joinCode;
};

/**
 * Create a new organization
 * @param {Object} data - Organization data
 * @param {string} data.name - Organization name
 * @param {string} data.slug - Organization slug (optional, will be generated if not provided)
 * @param {string} data.logo - Organization logo URL (optional)
 * @param {string} data.ownerId - User ID of the organization owner
 * @returns {Promise<Object>} Created organization and membership
 */
export const createOrganization = async ({ name, slug, logo, ownerId }) => {
  // Generate slug if not provided
  const organizationSlug = slug || `${name.toLowerCase().replace(/\s+/g, "-")}-${nanoid(6)}`;

  // Check if slug already exists
  const existingOrg = await organizationModel.findOne({ slug: organizationSlug });
  if (existingOrg) {
    throw new Error("Organization slug already exists", { cause: 409 });
  }

  // Get owner user details to add username to members array
  const owner = await userModel.findById(ownerId);
  if (!owner) {
    throw new Error("Owner user not found", { cause: 404 });
  }

  // Generate unique join code
  const joinCode = await generateUniqueJoinCode();

  // Create the organization
  const organization = await organizationModel.create({
    name,
    slug: organizationSlug,
    logo: logo || null,
    joinCode,
    ownerId,
    members: [owner.username],
  });

  // Create membership record for the owner
  const membership = await memberModel.create({
    organizationId: organization._id,
    userId: ownerId,
    role: "owner",
  });

  return {
    organization,
    membership,
  };
};

/**
 * Get organization by ID
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object>} Organization document
 */
export const getOrganizationById = async (organizationId) => {
  const organization = await organizationModel
    .findById(organizationId)
    .populate("ownerId", "userName email profileImage");
  
  if (!organization) {
    throw new Error("Organization not found", { cause: 404 });
  }

  return organization;
};

/**
 * Get organization by slug
 * @param {string} slug - Organization slug
 * @returns {Promise<Object>} Organization document
 */
export const getOrganizationBySlug = async (slug) => {
  const organization = await organizationModel
    .findOne({ slug })
    .populate("ownerId", "userName email profileImage");
  
  if (!organization) {
    throw new Error("Organization not found", { cause: 404 });
  }

  return organization;
};

/**
 * Get all organizations for a user
 * @param {string} userId - User ID
 * @returns {Promise<Array>} Array of organizations
 */
export const getUserOrganizations = async (userId) => {
  const memberships = await memberModel
    .find({ userId, isActive: true })
    .populate({
      path: "organizationId",
      populate: {
        path: "ownerId",
        select: "userName email profileImage",
      },
    });

  return memberships.map((m) => ({
    ...m.organizationId.toObject(),
    memberRole: m.role,
    joinedAt: m.joinedAt,
  }));
};

/**
 * Controller function to create organization
 */
// export const createOrganizationController = asyncHandler(async (req, res, next) => {
//   const { name, slug, logo } = req.body;
//   const ownerId = req.user._id;

//   const result = await createOrganization({
//     name,
//     slug,
//     logo,
//     ownerId,
//   });

//   return successResponse({
//     res,
//     message: "Organization created successfully",
//     data: result,
//     statusCode: 201,
//   });
// });

export const createOrganizationController = asyncHandler(async (req, res, next) => {
  const { name, slug, logo, ownerId } = req.body;

  const result = await createOrganization({
    name,
    slug,
    logo,
    ownerId,
  });

  return successResponse({
    res,
    message: "Organization created successfully",
    data: result,
    statusCode: 201,
  });
});

/**
 * Join an organization using join code
 * @param {Object} data - Join data
 * @param {string} data.email - User email
 * @param {string} data.password - User password
 * @param {string} data.joinCode - Organization join code
 * @returns {Promise<Object>} Organization and membership
 */
export const joinOrganization = async ({ email, password, joinCode }) => {
  // Find user by email
  const user = await userModel.findOne({ email });
  if (!user) {
    throw new Error("Invalid email or password", { cause: 401 });
  }

  // Verify password
  const isPasswordValid = compareHash({ plainText: password, hashValue: user.password });
  if (!isPasswordValid) {
    throw new Error("Invalid email or password", { cause: 401 });
  }

  // Check if user is verified
  if (!user.confirmEmail) {
    throw new Error("Please verify your email first", { cause: 403 });
  }

  // Find organization by join code
  const organization = await organizationModel.findOne({ joinCode: joinCode.toUpperCase() });
  if (!organization) {
    throw new Error("Invalid organization code", { cause: 404 });
  }

  // Check if user is already a member
  const existingMembership = await memberModel.findOne({
    organizationId: organization._id,
    userId: user._id,
  });

  if (existingMembership) {
    if (existingMembership.isActive) {
      throw new Error("You are already a member of this organization", { cause: 409 });
    } else {
      // Reactivate membership
      existingMembership.isActive = true;
      existingMembership.joinedAt = Date.now();
      await existingMembership.save();
      
      // Add username back to members array if not already there
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
  }

  // Create new membership
  const membership = await memberModel.create({
    organizationId: organization._id,
    userId: user._id,
    role: "member",
  });

  // Add username to organization members array
  organization.members.push(user.username);
  await organization.save();

  return {
    organization,
    membership,
  };
};

/**
 * Controller function to join organization
 */
export const joinOrganizationController = asyncHandler(async (req, res, next) => {
  const { email, password, joinCode } = req.body;

  const result = await joinOrganization({
    email,
    password,
    joinCode,
  });

  return successResponse({
    res,
    message: result.message || "Successfully joined organization",
    data: result,
    statusCode: 201,
  });
});
