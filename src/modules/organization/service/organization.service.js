import organizationModel from "../../../DB/Model/organization.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import workSessionModel from "../../../DB/Model/worksession.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";

// ─────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────

const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const genJoinCode = () => {
  // avoid visually confusing characters (0/O, 1/I)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++)
    out += chars[Math.floor(Math.random() * chars.length)];
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

// ─────────────────────────────────────────────────────────────
// EXPORTED HELPER — reused by member.service.js & invitation.service.js
// ─────────────────────────────────────────────────────────────

/**
 * Verify that userId is an active member of orgId with one of the given roles.
 * Throws a descriptive error (caught by asyncHandler) if not.
 */
export async function requireOrgRole({ orgId, userId, roles }) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member)
    throw new Error("You are not a member of this organization", { cause: 403 });
  if (!roles.includes(member.role))
    throw new Error("Not authorized", { cause: 403 });
  return member;
}

// ─────────────────────────────────────────────────────────────
// GET /org/me
// Returns all organizations the authenticated user belongs to.
// Equivalent to Slack workspace list.
// ─────────────────────────────────────────────────────────────

export const getMyOrganizations = asyncHandler(async (req, res, next) => {
  const memberships = await memberModel
    .find({ userId: req.user._id, isActive: true })
    .populate({
      path: "organizationId",
      match: { isDeleted: false, isActive: true },
      select: "name slug logo joinCode ownerId createdAt",
    })
    .lean();

  // filter out any deleted orgs (populate returns null for non-matching)
  const organizations = memberships
    .filter((m) => m.organizationId)
    .map((m) => ({
      ...m.organizationId,
      memberRole: m.role,
      joinedAt: m.joinedAt,
    }));

  return successResponse({ res, data: { organizations } });
});

// ─────────────────────────────────────────────────────────────
// GET /org/:orgId
// Returns org details, member count, and current user's role.
// ─────────────────────────────────────────────────────────────

export const getOrg = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;

  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: req.user._id, isActive: true },
  });
  if (!member) return next(new Error("Not a member of this organization", { cause: 403 }));

  const org = await dbService.findOne({
    model: organizationModel,
    filter: { _id: orgId, isDeleted: false },
  });
  if (!org) return next(new Error("Organization not found", { cause: 404 }));

  const memberCount = await memberModel.countDocuments({
    organizationId: orgId,
    isActive: true,
  });

  return successResponse({
    res,
    data: {
      ...org.toObject(),
      memberCount,
      memberRole: member.role,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// POST /org
// Creates a new organization and makes the creator the owner.
// ─────────────────────────────────────────────────────────────

export const createOrg = asyncHandler(async (req, res, next) => {
  const { name, slug: providedSlug, logo = null } = req.body;

  const baseSlug = providedSlug ? providedSlug : slugify(name);
  const slug = await ensureUniqueSlug(baseSlug);
  const joinCode = await ensureUniqueJoinCode();

  // logo: uploaded file takes priority, then URL from body
  const uploadedLogo = req.file
    ? `/${String(req.file.finalPath || "").replace(/\\/g, "/")}`
    : logo;

  const org = await dbService.create({
    model: organizationModel,
    data: {
      name,
      slug,
      logo: uploadedLogo || null,
      joinCode,
      ownerId: req.user._id,
      members: [req.user.username],
      isActive: true,
      isDeleted: false,
    },
  });

  // create owner membership record
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

// ─────────────────────────────────────────────────────────────
// PATCH /org/:orgId
// Updates org name, slug, or logo. Owner/admin only.
// ─────────────────────────────────────────────────────────────

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

  const uploadedLogo = req.file
    ? `/${String(req.file.finalPath || "").replace(/\\/g, "/")}`
    : null;

  if (uploadedLogo) update.logo = uploadedLogo;
  else if (logo !== undefined) update.logo = logo;

  if (providedSlug || name) {
    const baseSlug = providedSlug ? providedSlug : slugify(name);
    update.slug = await ensureUniqueSlug(baseSlug, orgId);
  }

  const updated = await dbService.findOneAndUpdate({
    model: organizationModel,
    filter: { _id: orgId, isDeleted: false },
    data: update,
    options: { new: true },
  });

  return successResponse({ res, message: "Organization updated", data: updated });
});

// ─────────────────────────────────────────────────────────────
// DELETE /org/:orgId
// Soft deletes org and deactivates all memberships. Owner only.
// ─────────────────────────────────────────────────────────────

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

  // deactivate all memberships so members lose access immediately
  await dbService.updateMany({
    model: memberModel,
    filter: { organizationId: orgId },
    data: { isActive: false },
  });

  return successResponse({ res, message: "Organization deleted" });
});

// ─────────────────────────────────────────────────────────────
// GET /org/:orgId/work-sessions
// Admin view of all member work sessions.
// Combines Jira Work Log + Time Doctor concept.
// ─────────────────────────────────────────────────────────────

export const getOrgWorkSessions = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { userId, status, from, to } = req.query;

  // only owner/admin can see all member sessions
  await requireOrgRole({ orgId, userId: req.user._id, roles: ["owner", "admin"] });

  const filter = { organizationId: orgId };
  if (userId) filter.userId = userId;
  if (status) filter.status = status;
  if (from || to) {
    filter.startTime = {};
    if (from) filter.startTime.$gte = new Date(from);
    if (to) filter.startTime.$lte = new Date(to);
  }

  const { page, limit, skip } = getPagination(req.query);

  const sessions = await dbService.find({
    model: workSessionModel,
    filter,
    populate: [
      { path: "userId", select: "username email image" },
      { path: "taskId", select: "title status priority" },
    ],
    skip,
    limit,
  });

  return successResponse({
    res,
    data: { sessions, total: sessions.length, page, limit },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /org/:orgId/work-sessions/summary
// Aggregated productivity summary per user.
// Shows active/idle/paused seconds and productivity %.
// ─────────────────────────────────────────────────────────────

export const getWorkSessionsSummary = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { from, to } = req.query;

  await requireOrgRole({ orgId, userId: req.user._id, roles: ["owner", "admin"] });

  const matchFilter = {
    organizationId: orgId,
    status: "stopped", // only count completed sessions
  };

  if (from || to) {
    matchFilter.startTime = {};
    if (from) matchFilter.startTime.$gte = new Date(from);
    if (to) matchFilter.startTime.$lte = new Date(to);
  }

  const summary = await workSessionModel.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: "$userId",
        totalSessions: { $sum: 1 },
        totalActiveSeconds: { $sum: "$activeSeconds" },
        totalIdleSeconds: { $sum: "$idleSeconds" },
        totalPausedSeconds: { $sum: "$pausedSeconds" },
        avgActivePerSession: { $avg: "$activeSeconds" },
      },
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
        pipeline: [
          { $project: { username: 1, email: 1, image: 1 } },
        ],
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmpty: false } },
    {
      $project: {
        _id: 0,
        userId: "$_id",
        user: 1,
        totalSessions: 1,
        totalActiveSeconds: 1,
        totalIdleSeconds: 1,
        totalPausedSeconds: 1,
        avgActivePerSession: { $round: ["$avgActivePerSession", 0] },
        // productivity % = activeSeconds / (activeSeconds + idleSeconds) * 100
        productivityPercent: {
          $cond: [
            {
              $gt: [
                { $add: ["$totalActiveSeconds", "$totalIdleSeconds"] },
                0,
              ],
            },
            {
              $round: [
                {
                  $multiply: [
                    {
                      $divide: [
                        "$totalActiveSeconds",
                        { $add: ["$totalActiveSeconds", "$totalIdleSeconds"] },
                      ],
                    },
                    100,
                  ],
                },
                2,
              ],
            },
            0,
          ],
        },
      },
    },
    { $sort: { totalActiveSeconds: -1 } },
  ]);

  return successResponse({ res, data: { summary } });
});

// ─────────────────────────────────────────────────────────────
// GET /org/:orgId/chat-rooms
// All chat rooms in this org that the user is a member of.
// Returns rooms grouped by type (like Slack sidebar sections).
// ─────────────────────────────────────────────────────────────

export const getOrgChatRooms = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;

  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId: req.user._id, isActive: true },
  });
  if (!member) return next(new Error("Not a member of this organization", { cause: 403 }));

  const rooms = await dbService.find({
    model: chatRoomModel,
    filter: {
      organizationId: orgId,
      members: req.user._id,
      isDeleted: false,
    },
    populate: [
      { path: "members", select: "username email image" },
      { path: "admins", select: "username image" },
      {
        path: "lastMessage",
        select: "content messageType senderId createdAt",
        populate: { path: "senderId", select: "username image" },
      },
    ],
  });

  // group by type — mirrors Slack sidebar sections
  const grouped = {
    organization: [],
    team: [],
    channel: [],
    group: [],
    direct: [],
  };

  for (const room of rooms) {
    if (grouped[room.type] !== undefined) {
      grouped[room.type].push(room);
    }
  }

  return successResponse({
    res,
    data: { rooms, grouped, total: rooms.length },
  });
});
