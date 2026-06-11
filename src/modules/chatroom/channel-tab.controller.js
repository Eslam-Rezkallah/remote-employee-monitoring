import { Router } from "express";
import joi from "joi";
import channelTabModel, {
  channelTabTypes,
} from "../../DB/Model/channelTab.model.js";
import chatRoomModel from "../../DB/Model/chatroom.model.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import { isValidObjectId } from "../../middleware/validation.middleware.js";
import { asyncHandler } from "../../utils/response/error.response.js";
import { successResponse } from "../../utils/response/success.response.js";
import { httpError } from "../../utils/errors/index.js";

const router = Router({ mergeParams: true });
router.use(authentication());

const id = joi.string().custom(isValidObjectId).required();

const createTab = joi
  .object({
    roomId: id,
    name: joi.string().trim().min(1).max(50).required(),
    type: joi
      .string()
      .valid(...Object.values(channelTabTypes))
      .required(),
    config: joi.object().default({}),
    order: joi.number().integer().min(0).default(0),
  })
  .required();

const updateTab = joi
  .object({
    roomId: id,
    tabId: id,
    name: joi.string().trim().min(1).max(50),
    config: joi.object(),
    order: joi.number().integer().min(0),
  })
  .required();

async function assertRoomMemberOrAdmin(roomId, userId, { adminOnly = false } = {}) {
  const room = await chatRoomModel
    .findOne({ _id: roomId, isDeleted: false })
    .select("members admins")
    .lean();
  if (!room) throw httpError(404, "Room not found");
  const isMember = (room.members || []).some(
    (m) => m.toString() === String(userId),
  );
  if (!isMember) throw httpError(403, "Not a room member");
  if (adminOnly) {
    const isAdmin = (room.admins || []).some(
      (a) => a.toString() === String(userId),
    );
    if (!isAdmin) throw httpError(403, "Only room admins can manage tabs");
  }
  return room;
}

// POST /chat/rooms/:roomId/tabs
router.post(
  "/",
  validation(createTab),
  asyncHandler(async (req, res) => {
    const { roomId } = req.params;
    await assertRoomMemberOrAdmin(roomId, req.user._id, { adminOnly: true });

    try {
      const tab = await channelTabModel.create({
        chatRoomId: roomId,
        name: req.body.name,
        type: req.body.type,
        config: req.body.config || {},
        order: req.body.order || 0,
        createdBy: req.user._id,
      });
      return successResponse({ res, status: 201, data: tab });
    } catch (err) {
      if (err.code === 11000) {
        throw httpError(409, "A tab with this name already exists");
      }
      throw err;
    }
  }),
);

// GET /chat/rooms/:roomId/tabs
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { roomId } = req.params;
    await assertRoomMemberOrAdmin(roomId, req.user._id);
    const items = await channelTabModel
      .find({ chatRoomId: roomId, isDeleted: false })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    return successResponse({ res, data: { items } });
  }),
);

// PATCH /chat/rooms/:roomId/tabs/:tabId
router.patch(
  "/:tabId",
  validation(updateTab),
  asyncHandler(async (req, res) => {
    const { roomId, tabId } = req.params;
    await assertRoomMemberOrAdmin(roomId, req.user._id, { adminOnly: true });
    const tab = await channelTabModel.findOne({
      _id: tabId,
      chatRoomId: roomId,
      isDeleted: false,
    });
    if (!tab) throw httpError(404, "Tab not found");
    if (req.body.name !== undefined) tab.name = req.body.name;
    if (req.body.config !== undefined) tab.config = req.body.config;
    if (req.body.order !== undefined) tab.order = req.body.order;
    await tab.save();
    return successResponse({ res, data: tab });
  }),
);

// DELETE /chat/rooms/:roomId/tabs/:tabId
router.delete(
  "/:tabId",
  asyncHandler(async (req, res) => {
    const { roomId, tabId } = req.params;
    await assertRoomMemberOrAdmin(roomId, req.user._id, { adminOnly: true });
    const r = await channelTabModel.updateOne(
      { _id: tabId, chatRoomId: roomId, isDeleted: false },
      { $set: { isDeleted: true } },
    );
    if (r.modifiedCount === 0) throw httpError(404, "Tab not found");
    return successResponse({ res, message: "Tab removed" });
  }),
);

export default router;
