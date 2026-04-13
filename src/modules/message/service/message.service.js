import messageModel from "../../../DB/Model/message.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { cloud } from "../../../utils/multer/cloudinary.multer.js";
// FIX: import chat namespace so REST handlers can emit socket events
import { getChatNamespace } from "../../socket/socket.controller.js";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const EDIT_WINDOW_MS = 60 * 60 * 1000;
const DELETE_WINDOW_MS = 60 * 60 * 1000;

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

function getCloudFolder(userId, roomId) {
  return `${process.env.APP_NAME}/chat/${roomId}/${userId}`;
}

function resolveAttachmentType(mimetype = "") {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "voice";
  return "file";
}

async function uploadAttachments(files, userId, roomId) {
  if (!files || !files.length) return [];

  const folder = getCloudFolder(userId, roomId);
  const resourceType = (mimetype) => {
    if (mimetype.startsWith("image/")) return "image";
    if (mimetype.startsWith("video/") || mimetype.startsWith("audio/"))
      return "video";
    return "raw";
  };

  return Promise.all(
    files.map(async (file) => {
      const result = await cloud.uploader.upload(file.path, {
        folder,
        resource_type: resourceType(file.mimetype),
      });
      return {
        type: resolveAttachmentType(file.mimetype),
        url: result.secure_url,
        public_id: result.public_id,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        duration: result.duration || null,
      };
    }),
  );
}

/**
 * FIX: helper to safely emit to the chat namespace.
 * Returns silently if socket.io isn't initialized yet.
 */
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
// FIX: now emits receive_message via socket after saving
// ─────────────────────────────────────────────────────────────

export const sendMessage = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;
  const { content = "", messageType = "text", replyTo } = req.body;

  await requireRoomMember(roomId, userId);

  if (replyTo) {
    const parent = await messageModel.findOne({
      _id: replyTo,
      chatRoomId: roomId,
      deletedForEveryone: false,
    });
    if (!parent)
      return next(new Error("Reply target not found", { cause: 404 }));
  }

  const rawFiles = req.files?.length ? req.files : req.file ? [req.file] : [];

  if (!content.trim() && !rawFiles.length) {
    return next(
      new Error("Message must have content or attachment", { cause: 400 }),
    );
  }

  const attachments = await uploadAttachments(rawFiles, userId, roomId);

  let resolvedType = messageType;
  if (attachments.length && messageType === "text") {
    resolvedType =
      attachments[0].type === "voice" ? "voice" : attachments[0].type;
  }

  const message = await messageModel.create({
    chatRoomId: roomId,
    senderId: userId,
    content: content.trim(),
    messageType: resolvedType,
    attachments,
    replyTo: replyTo || null,
  });

  await chatRoomModel.updateOne(
    { _id: roomId },
    { lastMessage: message._id, lastMessageAt: new Date() },
  );

  const populated = await messageModel
    .findById(message._id)
    .populate("senderId", "username email image")
    .populate("replyTo", "content senderId messageType")
    .lean();

  // FIX: broadcast to socket so other members see the message in real-time
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
// Uses message aggregation (single source of truth for unread counts)
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
// FIX: now emits message_edited via socket
// ─────────────────────────────────────────────────────────────

export const editMessage = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;
  const { content } = req.body;

  await requireRoomMember(roomId, userId);

  const message = await messageModel.findOne({
    _id: messageId,
    chatRoomId: roomId,
    deletedForEveryone: false,
  });
  if (!message) return next(new Error("Message not found", { cause: 404 }));
  if (message.senderId.toString() !== userId.toString())
    return next(new Error("Can only edit your own messages", { cause: 403 }));

  const age = Date.now() - new Date(message.createdAt).getTime();
  if (age > EDIT_WINDOW_MS)
    return next(new Error("Edit window expired (1 hour)", { cause: 403 }));

  const editedAt = new Date();

  const updated = await messageModel
    .findOneAndUpdate(
      { _id: messageId },
      { content: content.trim(), edited: true, editedAt },
      { new: true },
    )
    .populate("senderId", "username image");

  // FIX: notify room members via socket
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
// FIX: now emits message_deleted via socket
// ─────────────────────────────────────────────────────────────

export const deleteMessage = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;
  const { deleteType = "me" } = req.body;

  await requireRoomMember(roomId, userId);

  const message = await messageModel.findOne({
    _id: messageId,
    chatRoomId: roomId,
    deletedForEveryone: false,
  });
  if (!message) return next(new Error("Message not found", { cause: 404 }));

  const age = Date.now() - new Date(message.createdAt).getTime();

  if (deleteType === "everyone") {
    if (message.senderId.toString() !== userId.toString())
      return next(
        new Error("Can only delete your own messages for everyone", {
          cause: 403,
        }),
      );
    if (age > DELETE_WINDOW_MS)
      return next(
        new Error("Delete-for-everyone window expired (1 hour)", {
          cause: 403,
        }),
      );

    await messageModel.updateOne(
      { _id: messageId },
      {
        deletedForEveryone: true,
        deleted: true,
        content: "",
        attachments: [],
      },
    );

    // FIX: notify room members via socket
    emitToRoom(roomId, "message_deleted", {
      roomId,
      messageId,
      deleteType: "everyone",
      deletedBy: userId,
    });

    return successResponse({ res, message: "Message deleted for everyone" });
  }

  await messageModel.updateOne(
    { _id: messageId },
    { $addToSet: { deletedFor: userId } },
  );

  return successResponse({ res, message: "Message deleted for you" });
});

// ─────────────────────────────────────────────────────────────
// PATCH /:messageId/seen
// FIX: now emits messages_seen via socket
// ─────────────────────────────────────────────────────────────

export const markSeen = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const pivotMsg = await messageModel
    .findOne({ _id: messageId, chatRoomId: roomId })
    .select("createdAt");
  if (!pivotMsg) return next(new Error("Message not found", { cause: 404 }));

  const result = await messageModel.updateMany(
    {
      chatRoomId: roomId,
      createdAt: { $lte: pivotMsg.createdAt },
      "seenBy.userId": { $ne: userId },
      senderId: { $ne: userId },
    },
    { $addToSet: { seenBy: { userId, seenAt: new Date() } } },
  );

  // FIX: notify room members about read receipts via socket
  if (result.modifiedCount > 0) {
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
    data: { updated: result.modifiedCount },
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
