/**
 * modules/message/service/shared.message.service.js
 *
 * ── Single source of truth for message operations ──────────
 * Both REST (message.service.js) and Socket (chat.socket.js)
 * call these functions so bug fixes only need to happen once.
 */

import mongoose from "mongoose";
import messageModel from "../../../DB/Model/message.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import reactionModel, {
  validReactions,
} from "../../../DB/Model/reaction.model.js";
import userModel from "../../../DB/Model/user.model.js";
import { cloud } from "../../../utils/multer/cloudinary.multer.js";
import * as dbService from "../../../DB/db.service.js";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

export const EDIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const DELETE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// ─────────────────────────────────────────────────────────────
// GUARDS
// ─────────────────────────────────────────────────────────────

export async function requireRoomMember(roomId, userId) {
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    throw Object.assign(new Error("Invalid room ID"), { cause: 400 });
  }
  const room = await dbService.findOne({
    model: chatRoomModel,
    filter: {
      _id: roomId,
      members: userId,
      isDeleted: false,
    },
  });
  if (!room) {
    throw Object.assign(new Error("Room not found or access denied"), {
      cause: 404,
    });
  }
  return room;
}

// ─────────────────────────────────────────────────────────────
// ATTACHMENT HELPERS
// ─────────────────────────────────────────────────────────────

function resolveAttachmentType(mimetype = "") {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  if (mimetype.startsWith("audio/")) return "voice";
  return "file";
}

function getCloudFolder(userId, roomId) {
  return `${process.env.APP_NAME}/chat/${roomId}/${userId}`;
}

export async function uploadAttachments(files, userId, roomId) {
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

// ─────────────────────────────────────────────────────────────
// SEND MESSAGE
// ─────────────────────────────────────────────────────────────

export async function createMessage({
  roomId,
  userId,
  content = "",
  messageType = "text",
  replyTo = null,
  attachments = [],
  forwardedFrom = null,
}) {
  // Validate reply target
  if (replyTo) {
    const parent = await dbService.findOne({
      model: messageModel,
      filter: {
        _id: replyTo,
        chatRoomId: roomId,
        deletedForEveryone: false,
      },
    });
    if (!parent) {
      throw Object.assign(new Error("Reply target not found"), { cause: 404 });
    }
  }

  // Validate forward source
  if (forwardedFrom) {
    const source = await dbService.findOne({
      model: messageModel,
      filter: {
        _id: forwardedFrom,
        deletedForEveryone: false,
      },
    });
    if (!source) {
      throw Object.assign(new Error("Forwarded message not found"), {
        cause: 404,
      });
    }
  }

  if (!content.trim() && !attachments.length) {
    throw Object.assign(new Error("Message must have content or attachment"), {
      cause: 400,
    });
  }

  // Resolve message type from attachment if needed
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
    forwardedFrom: forwardedFrom || null,
  });

  await chatRoomModel.updateOne(
    { _id: roomId },
    { lastMessage: message._id, lastMessageAt: new Date() },
  );

  const populated = await messageModel
    .findById(message._id)
    .populate("senderId", "username email image")
    .populate("replyTo", "content senderId messageType")
    .populate(
      "forwardedFrom",
      "content senderId messageType chatRoomId createdAt",
    )
    .lean();

  return populated;
}

// ─────────────────────────────────────────────────────────────
// EDIT MESSAGE
// ─────────────────────────────────────────────────────────────

export async function editMessageById({ roomId, messageId, userId, content }) {
  const message = await dbService.findOne({
    model: messageModel,
    filter: {
      _id: messageId,
      chatRoomId: roomId,
      deletedForEveryone: false,
    },
  });

  if (!message) {
    throw Object.assign(new Error("Message not found"), { cause: 404 });
  }
  if (message.senderId.toString() !== userId.toString()) {
    throw Object.assign(new Error("Can only edit your own messages"), {
      cause: 403,
    });
  }

  const age = Date.now() - new Date(message.createdAt).getTime();
  if (age > EDIT_WINDOW_MS) {
    throw Object.assign(new Error("Edit window expired (1 hour)"), {
      cause: 403,
    });
  }

  const editedAt = new Date();

  const updated = await messageModel
    .findOneAndUpdate(
      { _id: messageId },
      { content: content.trim(), edited: true, editedAt },
      { new: true },
    )
    .populate("senderId", "username image");

  return { updated, editedAt };
}

// ─────────────────────────────────────────────────────────────
// DELETE MESSAGE
// ─────────────────────────────────────────────────────────────

export async function deleteMessageById({
  roomId,
  messageId,
  userId,
  deleteType = "me",
}) {
  const message = await messageModel.findOne({
    _id: messageId,
    chatRoomId: roomId,
    deletedForEveryone: false,
  });

  if (!message) {
    throw Object.assign(new Error("Message not found"), { cause: 404 });
  }

  const age = Date.now() - new Date(message.createdAt).getTime();

  if (deleteType === "everyone") {
    if (message.senderId.toString() !== userId.toString()) {
      throw Object.assign(
        new Error("Can only delete your own messages for everyone"),
        { cause: 403 },
      );
    }
    if (age > DELETE_WINDOW_MS) {
      throw Object.assign(
        new Error("Delete-for-everyone window expired (1 hour)"),
        { cause: 403 },
      );
    }

    await messageModel.updateOne(
      { _id: messageId },
      {
        deletedForEveryone: true,
        deleted: true,
        content: "",
        attachments: [],
      },
    );

    return { deleteType: "everyone" };
  }

  // delete for me
  await messageModel.updateOne(
    { _id: messageId },
    { $addToSet: { deletedFor: userId } },
  );

  return { deleteType: "me" };
}

// ─────────────────────────────────────────────────────────────
// MARK SEEN (batch up to pivot message)
// ─────────────────────────────────────────────────────────────

/**
 * Marks all messages in a room up to (and including) the pivot
 * message as seen by the given user.
 *
 * If the user has disabled readReceipts, we still track locally
 * (so unread count works for THEM) but broadcastSeen = false
 * tells the caller NOT to emit the seen event to other users.
 *
 * @returns {{ modifiedCount: number, broadcastSeen: boolean }}
 */
export async function markMessagesSeen({ roomId, messageId, userId }) {
  const pivotMsg = await messageModel
    .findOne({ _id: messageId, chatRoomId: roomId })
    .select("createdAt");

  if (!pivotMsg) {
    throw Object.assign(new Error("Message not found"), { cause: 404 });
  }

  const result = await messageModel.updateMany(
    {
      chatRoomId: roomId,
      createdAt: { $lte: pivotMsg.createdAt },
      "seenBy.userId": { $ne: userId },
      senderId: { $ne: userId },
    },
    { $addToSet: { seenBy: { userId, seenAt: new Date() } } },
  );

  // Check if user has read receipts enabled
  const userDoc = await userModel
    .findById(userId)
    .select("readReceipts")
    .lean();
  const broadcastSeen = userDoc?.readReceipts !== false; // default true

  return {
    modifiedCount: result.modifiedCount,
    broadcastSeen,
  };
}

// ─────────────────────────────────────────────────────────────
// REACTIONS
// ─────────────────────────────────────────────────────────────

/**
 * Add or change a reaction. Returns { reactionDoc, summary }.
 */
export async function addReactionToMessage({
  roomId,
  messageId,
  userId,
  reaction,
}) {
  if (!validReactions.includes(reaction)) {
    throw Object.assign(
      new Error(`Invalid reaction. Allowed: ${validReactions.join(", ")}`),
      { cause: 400 },
    );
  }

  const message = await messageModel.findOne({
    _id: messageId,
    chatRoomId: roomId,
    deletedForEveryone: false,
  });
  if (!message) {
    throw Object.assign(new Error("Message not found"), { cause: 404 });
  }

  const existing = await dbService.findOne({
    model: reactionModel,
    filter: { messageId, userId },
  });
  let reactionDoc;

  if (existing) {
    if (existing.reaction === reaction) {
      return { reactionDoc: existing, unchanged: true };
    }
    existing.reaction = reaction;
    await existing.save();
    reactionDoc = existing;
  } else {
    reactionDoc = await dbService.create({
      model: reactionModel,
      data: {
        messageId,
        chatRoomId: roomId,
        userId,
        reaction,
      },
    });
    await messageModel.updateOne(
      { _id: messageId },
      { $addToSet: { reactions: reactionDoc._id } },
    );
  }

  // FIX: use model.aggregate directly — dbService has no aggregate method
  const summary = await reactionModel.aggregate([
    { $match: { messageId: message._id } },
    { $group: { _id: "$reaction", count: { $sum: 1 } } },
    { $project: { reaction: "$_id", count: 1, _id: 0 } },
  ]);

  return { reactionDoc, summary, unchanged: false };
}

/**
 * Remove a user's reaction. Returns { summary }.
 */
export async function removeReactionFromMessage({ roomId, messageId, userId }) {
  const reactionDoc = await dbService.findOneAndDelete({
    model: reactionModel,
    filter: { messageId, userId },
  });

  if (!reactionDoc) {
    throw Object.assign(new Error("Reaction not found"), { cause: 404 });
  }

  await messageModel.updateOne(
    { _id: messageId },
    { $pull: { reactions: reactionDoc._id } },
  );

  // FIX: use model.aggregate directly — dbService has no aggregate method
  const summary = await reactionModel.aggregate([
    { $match: { messageId: reactionDoc.messageId } },
    { $group: { _id: "$reaction", count: { $sum: 1 } } },
    { $project: { reaction: "$_id", count: 1, _id: 0 } },
  ]);

  return { summary };
}

// ─────────────────────────────────────────────────────────────
// FORWARD MESSAGE
// ─────────────────────────────────────────────────────────────

export async function forwardMessage({
  sourceMessageId,
  targetRoomId,
  userId,
}) {
  const sourceMsg = await dbService.findOne({
    model: messageModel,
    filter: {
      _id: sourceMessageId,
      deletedForEveryone: false,
    },
  });

  if (!sourceMsg) {
    throw Object.assign(new Error("Source message not found"), { cause: 404 });
  }

  // Verify membership in source room
  await requireRoomMember(sourceMsg.chatRoomId, userId);
  // Verify membership in target room
  await requireRoomMember(targetRoomId, userId);

  // Cannot forward to the same room
  if (sourceMsg.chatRoomId.toString() === targetRoomId.toString()) {
    throw Object.assign(new Error("Cannot forward to the same room"), {
      cause: 400,
    });
  }

  // Create forwarded message
  const forwarded = await createMessage({
    roomId: targetRoomId,
    userId,
    content: sourceMsg.content,
    messageType: sourceMsg.messageType,
    attachments: sourceMsg.attachments || [],
    forwardedFrom: sourceMsg._id,
  });

  return forwarded;
}
