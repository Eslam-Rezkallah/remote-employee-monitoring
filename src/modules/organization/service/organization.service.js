import organizationModel from "../../../DB/Model/organization.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";

const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const genJoinCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusing chars
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

async function ensureUniqueSlug(baseSlug, excludeOrgId = null) {
  let slug = baseSlug;
  let i = 1;

  while (true) {
    const filter = excludeOrgId
      ? { slug, _id: { $ne: excludeOrgId }, isDeleted: false }
      : { slug, isDeleted: false };

    const exists = await dbService.findOne({ model: organizationModel, filter });
    if (!exists) return slug;

    slug = `${baseSlug}-${++i}`;
  }
}

async function ensureUniqueJoinCode() {
  while (true) {
    const joinCode = genJoinCode();
    const exists = await dbService.findOne({
      model: organizationModel,
      filter: { joinCode, isDeleted: false },
    });
    if (!exists) return joinCode;
  }
}

async function requireOrgRole({ orgId, userId, roles }) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member) throw new Error("You are not a member of this organization", { cause: 403 });
  if (!roles.includes(member.role)) throw new Error("Not authorized", { cause: 403 });
  return member;
}

async function uploadOrganizationLogo({ file }) {
  if (!file) return null;
  return `/${String(file.finalPath || "").replace(/\\/g, "/")}`;
}

/**
 * BE-1.8 Create org
 * POST /org  (protected)
 * - slug unique
 * - joinCode unique
 * - creates Member(owner)
 */
export const createOrg = asyncHandler(async (req, res, next) => {
  const { name, slug: providedSlug, logo = null } = req.body;

  const baseSlug = providedSlug ? providedSlug : slugify(name);
  const slug = await ensureUniqueSlug(baseSlug);
  const joinCode = await ensureUniqueJoinCode();
  const uploadedLogo = await uploadOrganizationLogo({
    file: req.file,
  });
  const logoUrl = uploadedLogo || logo;

  const org = await dbService.create({
    model: organizationModel,
    data: {
      name,
      slug,
      logo: logoUrl,
      joinCode,
      ownerId: req.user._id,
      isActive: true,
      isDeleted: false,
    },
  });

  await dbService.create({
    model: memberModel,
    data: {
      organizationId: org._id,
      userId: req.user._id,
      role: "owner",
      isActive: true,
    },
  });

  return successResponse({ res, message: "Organization created", data: org }, 201);
});

/**
 * BE-2.3 Update org (owner/admin only)
 * PATCH /org/:orgId
 */
export const updateOrg = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { name, slug: providedSlug, logo } = req.body;

  await requireOrgRole({ orgId, userId: req.user._id, roles: ["owner", "admin"] });

  const org = await dbService.findOne({
    model: organizationModel,
    filter: { _id: orgId, isDeleted: false },
  });
  if (!org) return next(new Error("Organization not found", { cause: 404 }));

  const update = {};
  if (name) update.name = name;
  const uploadedLogo = await uploadOrganizationLogo({
    file: req.file,
  });
  if (uploadedLogo) {
    update.logo = uploadedLogo;
  } else if (typeof logo !== "undefined") {
    update.logo = logo;
  }

  if (providedSlug || name) {
    const baseSlug = providedSlug ? providedSlug : slugify(name);
    update.slug = await ensureUniqueSlug(baseSlug, orgId);
  }

  const updated = await organizationModel.findOneAndUpdate(
    { _id: orgId, isDeleted: false },
    update,
    { new: true }
  );

  return successResponse({ res, message: "Organization updated", data: updated }, 200);
});

/**
 * BE-2.4 Delete org (owner only)
 * DELETE /org/:orgId
 * soft delete => isDeleted=true (and optionally isActive=false)
 */
export const deleteOrg = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;

  await requireOrgRole({ orgId, userId: req.user._id, roles: ["owner"] });

  const org = await dbService.findOne({
    model: organizationModel,
    filter: { _id: orgId, isDeleted: false },
  });
  if (!org) return next(new Error("Organization not found", { cause: 404 }));

  await dbService.updateOne({
    model: organizationModel,
    filter: { _id: orgId },
    data: { isDeleted: true, isActive: false },
  });

  // optional: deactivate memberships
  await memberModel.updateMany({ organizationId: orgId }, { isActive: false });

  return successResponse({ res, message: "Organization deleted" }, 200);
});
