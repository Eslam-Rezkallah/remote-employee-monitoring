import Space from "../../../DB/Model/space.model.js";
import SpaceView, { viewTypes } from "../../../DB/Model/spaceView.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";

async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member) throw new Error("Not a member of this organization", { cause: 403 });
  return member;
}

const DEFAULT_VIEWS = [
  { type: viewTypes.Summary, name: "Summary" },
  { type: viewTypes.Timeline, name: "Timeline" },
  { type: viewTypes.Backlog, name: "Backlog" },
  { type: viewTypes.Sprints, name: "Active Sprints" },
  { type: viewTypes.Calendar, name: "Calendar" },
];

export const createSpace = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { name, icon = "", type } = req.body;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.create({
    model: Space,
    data: {
      name,
      icon,
      type,
      organizationId: orgId,
      createdBy: req.user._id,
      isDeleted: false,
    },
  });

  // Auto-create bundle of default views
  await SpaceView.insertMany(
    DEFAULT_VIEWS.map((v) => ({
      spaceId: space._id,
      organizationId: orgId,
      name: v.name,
      type: v.type,
      isDefault: true,
      config: {},
      isDeleted: false,
    }))
  );

  return successResponse(
    { res, message: "Space created", data: space },
    201
  );
});

export const listSpaces = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { type, q, page = 1, limit = 20 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const filter = { organizationId: orgId, isDeleted: false };
  if (type) filter.type = type;
  if (q) filter.name = { $regex: q, $options: "i" };

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Space.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Space.countDocuments(filter),
  ]);

  return successResponse(
    { res, data: { items, total, page: Number(page), limit: Number(limit) } },
    200
  );
});

export const searchSpaces = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { q, limit = 20 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const items = await Space.find({
    organizationId: orgId,
    isDeleted: false,
    $text: { $search: q },
  })
    .limit(Number(limit))
    .select("name icon type organizationId createdAt");

  return successResponse({ res, data: { items } }, 200);
});
