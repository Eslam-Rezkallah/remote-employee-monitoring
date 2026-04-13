import callModel, { callStatus } from "../../../DB/Model/call.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

async function requireRoomMember(roomId, userId) {
  const room = await chatRoomModel.findOne({
    _id: roomId,
    members: userId,
    isDeleted: false,
  });
  if (!room)
    throw Object.assign(new Error("Room not found or access denied"), {
      cause: 404,
    });
  return room;
}

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/calls
// Call history for a room (paginated, newest first)
// ─────────────────────────────────────────────────────────────

export const getCallHistory = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    chatRoomId: roomId,
    status: { $ne: callStatus.RINGING }, // don't show currently ringing calls in history
  };

  const [calls, total] = await Promise.all([
    callModel
      .find(filter)
      .populate("callerId", "username email image")
      .populate("participants.userId", "username image")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    callModel.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: {
      calls,
      total,
      page,
      limit,
      hasMore: skip + limit < total,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/calls/active
// Check if there's an active/ringing call in this room
// ─────────────────────────────────────────────────────────────

export const getActiveCall = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const call = await callModel
    .findOne({
      chatRoomId: roomId,
      status: { $in: [callStatus.RINGING, callStatus.ACTIVE] },
    })
    .populate("callerId", "username email image")
    .populate("participants.userId", "username image")
    .lean();

  return successResponse({
    res,
    data: { call: call || null, hasActiveCall: !!call },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/calls/:callId
// Get details of a specific call
// ─────────────────────────────────────────────────────────────

export const getCall = asyncHandler(async (req, res, next) => {
  const { roomId, callId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const call = await callModel
    .findOne({ _id: callId, chatRoomId: roomId })
    .populate("callerId", "username email image")
    .populate("participants.userId", "username image")
    .lean();

  if (!call) return next(new Error("Call not found", { cause: 404 }));

  return successResponse({ res, data: { call } });
});
