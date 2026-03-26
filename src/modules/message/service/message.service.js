import mongoose from "mongoose";
import messageModel from "../../../DB/Model/message.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { cloud } from "../../../utils/multer/cloudinary.multer.js";

/* ============================================================
   Constants
============================================================ */
const EDIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DELETE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/* ============================================================
   Shared helpers
============================================================ */

/** Assert user is a room member and return the room. */
async function requireRoomMember(roomId, userId) {
  const room = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: roomId, members: userId, isDeleted: false },
  });
  if (!room)
    throw Object.assign(new Error("Room not found or access denied"), {
      cause: 404,
    });
  return room;
}

/** Determine Cloudinary folder for a message attachment. */
function getCloudFolder(userId, roomId) {
  return `${process.env.APP_NAME}/chat/${roomId}/${userId}`;
}

/** Determine attachment type from mimetype. */
function resolveAttachmentType(mimetype = "") {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "voice";
  return "file";
}

/** Upload files to Cloudinary and return attachment objects. */
async function uploadAttachments(files, userId, roomId) {
  if (!files || !files.length) return [];

  const folder = getCloudFolder(userId, roomId);
  const resourceType = (mimetype) => {
    if (mimetype.startsWith("image/")) return "image";
    if (mimetype.startsWith("video/") || mimetype.startsWith("audio/"))
      return "video";
    return "raw";
  };

  const uploads = await Promise.all(
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

  return uploads;
}

/* ============================================================
   POST /chat/rooms/:roomId/messages
   Send a message (text, image, voice, file)
============================================================ */
export const sendMessage = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;
  const { content = "", messageType = "text", replyTo } = req.body;

  await requireRoomMember(roomId, userId);

  // Validate reply target
  if (replyTo) {
    const parent = await dbService.findOne({
      model: messageModel,
      filter: { _id: replyTo, chatRoomId: roomId, deletedForEveryone: false },
    });
    if (!parent)
      return next(new Error("Reply target not found", { cause: 404 }));
  }

  // Handle file attachments (multer populates req.files or req.file)
  const rawFiles = req.files?.length ? req.files : req.file ? [req.file] : [];

  // Must have content OR attachment
  if (!content.trim() && !rawFiles.length) {
    return next(
      new Error("Message must have content or attachment", { cause: 400 }),
    );
  }

  const attachments = await uploadAttachments(rawFiles, userId, roomId);

  // Resolve message type
  let resolvedType = messageType;
  if (attachments.length && messageType === "text") {
    resolvedType =
      attachments[0].type === "voice" ? "voice" : attachments[0].type;
  }

  const message = await dbService.create({
    model: messageModel,
    data: {
      chatRoomId: roomId,
      senderId: userId,
      content: content.trim(),
      messageType: resolvedType,
      attachments,
      replyTo: replyTo || null,
    },
  });

  // Update chatroom's last message
  await dbService.updateOne({
    model: chatRoomModel,
    filter: { _id: roomId },
    data: { lastMessage: message._id, lastMessageAt: new Date() },
  });

  // Populate sender for immediate response
  const populated = await messageModel
    .findById(message._id)
    .populate("senderId", "username email image")
    .populate("replyTo", "content senderId messageType")
    .lean();

  return successResponse(
    { res, data: { message: populated }, message: "Message sent" },
    201,
  );
});

/* ============================================================
   GET /chat/rooms/:roomId/messages
   Paginated message history (newest first or cursor-based)
============================================================ */
export const listMessages = asyncHandler(async (req, res, next) => {
  const { roomId } = req.params;
  const userId = req.user._id;
  const { page = 1, limit = 30, before } = req.query;

  await requireRoomMember(roomId, userId);

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const filter = {
    chatRoomId: roomId,
    deletedForEveryone: false,
    deletedFor: { $ne: userId }, // exclude messages deleted for this user
  };

  // Cursor-based pagination: messages before a given date
  if (before) {
    filter.createdAt = { $lt: new Date(before) };
  }

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
      .limit(parseInt(limit))
      .lean(),
    messageModel.countDocuments(filter),
  ]);

  // Return in chronological order
  messages.reverse();

  return successResponse({
    res,
    data: {
      messages,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
    },
  });
});

/* ============================================================
   PATCH /chat/rooms/:roomId/messages/:messageId
   Edit a message (owner only, within 1 hour)
============================================================ */
export const editMessage = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;
  const { content } = req.body;

  await requireRoomMember(roomId, userId);

  const message = await dbService.findOne({
    model: messageModel,
    filter: {
      _id: messageId,
      chatRoomId: roomId,
      deletedForEveryone: false,
    },
  });

  if (!message) return next(new Error("Message not found", { cause: 404 }));
  if (message.senderId.toString() !== userId.toString()) {
    return next(new Error("Can only edit your own messages", { cause: 403 }));
  }

  // 1-hour edit window
  const age = Date.now() - new Date(message.createdAt).getTime();
  if (age > EDIT_WINDOW_MS) {
    return next(new Error("Edit window expired (1 hour)", { cause: 403 }));
  }

  const updated = await dbService.findOneAndUpdate({
    model: messageModel,
    filter: { _id: messageId },
    data: { content: content.trim(), edited: true, editedAt: new Date() },
    options: { new: true },
    populate: [{ path: "senderId", select: "username image" }],
  });

  return successResponse({
    res,
    data: { message: updated },
    message: "Message edited",
  });
});

/* ============================================================
   DELETE /chat/rooms/:roomId/messages/:messageId
   Delete a message (within 1 hour)
   deleteType: "me" | "everyone"
============================================================ */
export const deleteMessage = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;
  const { deleteType = "me" } = req.body;

  await requireRoomMember(roomId, userId);

  const message = await dbService.findOne({
    model: messageModel,
    filter: {
      _id: messageId,
      chatRoomId: roomId,
      deletedForEveryone: false,
    },
  });

  if (!message) return next(new Error("Message not found", { cause: 404 }));

  const age = Date.now() - new Date(message.createdAt).getTime();

  // Delete for everyone: owner only, within 1 hour
  if (deleteType === "everyone") {
    if (message.senderId.toString() !== userId.toString()) {
      return next(
        new Error("Can only delete your own messages for everyone", {
          cause: 403,
        }),
      );
    }
    if (age > DELETE_WINDOW_MS) {
      return next(
        new Error("Delete-for-everyone window expired (1 hour)", {
          cause: 403,
        }),
      );
    }

    await dbService.updateOne({
      model: messageModel,
      filter: { _id: messageId },
      data: {
        deletedForEveryone: true,
        deleted: true,
        content: "",
        attachments: [],
      },
    });

    return successResponse({ res, message: "Message deleted for everyone" });
  }

  // Delete for me: just push userId to deletedFor
  await dbService.updateOne({
    model: messageModel,
    filter: { _id: messageId },
    data: { $addToSet: { deletedFor: userId } },
  });

  return successResponse({ res, message: "Message deleted for you" });
});

/* ============================================================
   PATCH /chat/rooms/:roomId/messages/:messageId/seen
   Mark a message (and all before it) as seen by the user
============================================================ */
export const markSeen = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  // Mark all messages up to and including messageId as seen
  const pivotMsg = await dbService.findOne({
    model: messageModel,
    filter: { _id: messageId, chatRoomId: roomId },
    select: "createdAt",
  });

  if (!pivotMsg) return next(new Error("Message not found", { cause: 404 }));

  const result = await messageModel.updateMany(
    {
      chatRoomId: roomId,
      createdAt: { $lte: pivotMsg.createdAt },
      "seenBy.userId": { $ne: userId },
      senderId: { $ne: userId }, // don't mark own messages
    },
    { $addToSet: { seenBy: { userId, seenAt: new Date() } } },
  );

  return successResponse({
    res,
    message: "Messages marked as seen",
    data: { updated: result.modifiedCount },
  });
});

/* ============================================================
   PATCH /chat/rooms/:roomId/messages/:messageId/delivered
   Mark a message as delivered to the requesting user
============================================================ */
export const markDelivered = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  await dbService.updateOne({
    model: messageModel,
    filter: {
      _id: messageId,
      chatRoomId: roomId,
      "deliveredTo.userId": { $ne: userId },
    },
    data: { $addToSet: { deliveredTo: { userId, deliveredAt: new Date() } } },
  });

  return successResponse({ res, message: "Message marked as delivered" });
});
