/**
 * modules/message/service/message.service.js
 *
 * ── REFACTORED ──────────────────────────────────────────────
 * All core logic (create, edit, delete, seen, reactions) now
 * lives in shared.message.service.js.  This file is a thin
 * REST wrapper that calls the shared functions and emits
 * socket events.
 */

import messageModel from "../../../DB/Model/message.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { getChatNamespace } from "../../socket/socket.controller.js";

// ── Shared service ────────────────────────────────────────────
import {
  requireRoomMember,
  uploadAttachments,
  createMessage,
  editMessageById,
  deleteMessageById,
  markMessagesSeen,
  forwardMessage,
} from "./shared.message.service.js";

// ─────────────────────────────────────────────────────────────
// SOCKET HELPER
// ─────────────────────────────────────────────────────────────

function emitToRoom(roomId, event, payload) {
  try {
    const chatNs = getChatNamespace();
    if (chatNs) {
      chatNs.to(`room:${roomId}`).emit(event, payload);
    }
  } catch (_) {
    // socket not initialized — skip silently
  }
}

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/messages  — Send
// ─────────────────────────────────────────────────────────────

export const sendMessage = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;
  const { content = "", messageType = "text", replyTo } = req.body;

  await requireRoomMember(roomId, userId);

  const rawFiles = req.files?.length ? req.files : req.file ? [req.file] : [];
  const attachments = await uploadAttachments(rawFiles, userId, roomId);

  const populated = await createMessage({
    roomId,
    userId,
    content,
    messageType,
    replyTo,
    attachments,
  });

  // Broadcast to socket
  emitToRoom(roomId, "receive_message", {
    message: populated,
    roomId,
  });

  return successResponse(
    { res, data: { message: populated }, message: "Message sent" },
    201,
  );
});

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/messages/forward  — Forward
// ─────────────────────────────────────────────────────────────

export const forwardMessageHandler = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params; // target room
  const userId = req.user._id;
  const { sourceMessageId } = req.body;

  const populated = await forwardMessage({
    sourceMessageId,
    targetRoomId: roomId,
    userId,
  });

  // Broadcast to target room
  emitToRoom(roomId, "receive_message", {
    message: populated,
    roomId,
  });

  return successResponse(
    { res, data: { message: populated }, message: "Message forwarded" },
    201,
  );
});

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/messages  — History
// ─────────────────────────────────────────────────────────────

export const listMessages = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;
  const { before } = req.query;

  await requireRoomMember(roomId, userId);

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    chatRoomId: roomId,
    deletedForEveryone: false,
    deletedFor: { $ne: userId },
  };
  if (before) filter.createdAt = { $lt: new Date(before) };

  const [messages, total] = await Promise.all([
    messageModel
      .find(filter)
      .populate("senderId", "username email image")
      .populate("replyTo", "content senderId messageType attachments")
      .populate(
        "forwardedFrom",
        "content senderId messageType chatRoomId createdAt",
      )
      .populate({
        path: "reactions",
        select: "reaction userId",
        populate: { path: "userId", select: "username image" },
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    messageModel.countDocuments(filter),
  ]);

  messages.reverse();

  return successResponse({
    res,
    data: {
      messages,
      total,
      page,
      limit,
      hasMore: skip + limit < total,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/messages/search
// ─────────────────────────────────────────────────────────────

export const searchMessages = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;
  const { q } = req.query;

  await requireRoomMember(roomId, userId);

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    chatRoomId: roomId,
    deletedForEveryone: false,
    deletedFor: { $ne: userId },
    $text: { $search: q },
  };

  const [messages, total] = await Promise.all([
    messageModel
      .find(filter, { score: { $meta: "textScore" } })
      .populate("senderId", "username email image")
      .sort({ score: { $meta: "textScore" } })
      .skip(skip)
      .limit(limit)
      .lean(),
    messageModel.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: {
      messages,
      total,
      page,
      limit,
      query: q,
      hasMore: skip + limit < total,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/unread-counts
// ─────────────────────────────────────────────────────────────

export const getUnreadCounts = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  const rooms = await chatRoomModel
    .find({ members: userId, isDeleted: false })
    .select("_id")
    .lean();

  const roomIds = rooms.map((r) => r._id);

  const unreadCounts = await messageModel.aggregate([
    {
      $match: {
        chatRoomId: { $in: roomIds },
        deletedForEveryone: false,
        deletedFor: { $ne: userId },
        senderId: { $ne: userId },
        "seenBy.userId": { $ne: userId },
      },
    },
    {
      $group: {
        _id: "$chatRoomId",
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = {};
  for (const item of unreadCounts) {
    counts[item._id.toString()] = item.count;
  }

  const totalUnread = unreadCounts.reduce((sum, item) => sum + item.count, 0);

  return successResponse({ res, data: { counts, totalUnread } });
});

// ─────────────────────────────────────────────────────────────
// PATCH /:messageId  — Edit
// ─────────────────────────────────────────────────────────────

export const editMessage = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;
  const { content } = req.body;

  await requireRoomMember(roomId, userId);

  const { updated, editedAt } = await editMessageById({
    roomId,
    messageId,
    userId,
    content,
  });

  emitToRoom(roomId, "message_edited", {
    roomId,
    messageId,
    content: content.trim(),
    editedAt,
    editedBy: userId,
  });

  return successResponse({
    res,
    data: { message: updated },
    message: "Message edited",
  });
});

// ─────────────────────────────────────────────────────────────
// DELETE /:messageId
// ─────────────────────────────────────────────────────────────

export const deleteMessage = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;
  const { deleteType = "me" } = req.body;

  await requireRoomMember(roomId, userId);

  const result = await deleteMessageById({
    roomId,
    messageId,
    userId,
    deleteType,
  });

  if (result.deleteType === "everyone") {
    emitToRoom(roomId, "message_deleted", {
      roomId,
      messageId,
      deleteType: "everyone",
      deletedBy: userId,
    });
    return successResponse({ res, message: "Message deleted for everyone" });
  }

  return successResponse({ res, message: "Message deleted for you" });
});

// ─────────────────────────────────────────────────────────────
// PATCH /:messageId/seen
// ─────────────────────────────────────────────────────────────

export const markSeen = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const { modifiedCount, broadcastSeen } = await markMessagesSeen({
    roomId,
    messageId,
    userId,
  });

  // Only broadcast read receipts if user has them enabled
  if (modifiedCount > 0 && broadcastSeen) {
    emitToRoom(roomId, "messages_seen", {
      roomId,
      messageId,
      seenBy: {
        userId,
        username: req.user.username,
        seenAt: new Date(),
      },
    });
  }

  return successResponse({
    res,
    message: "Messages marked as seen",
    data: { updated: modifiedCount },
  });
});

// ─────────────────────────────────────────────────────────────
// PATCH /:messageId/delivered
// ─────────────────────────────────────────────────────────────

export const markDelivered = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  await messageModel.updateOne(
    {
      _id: messageId,
      chatRoomId: roomId,
      "deliveredTo.userId": { $ne: userId },
    },
    { $addToSet: { deliveredTo: { userId, deliveredAt: new Date() } } },
  );

  return successResponse({ res, message: "Message marked as delivered" });
});
