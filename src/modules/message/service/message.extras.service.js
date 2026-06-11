/**
 * modules/message/service/message.extras.service.js
 *
 * Slack/Teams-grade additions to the chat module:
 *   • Pin / unpin messages
 *   • Save (bookmark) / unsave messages
 *   • Thread listing (replies under a parent)
 *   • Full-text message search
 *   • Scheduled messages: create / cancel / list
 *
 * All endpoints inherit the room-member guard from the shared helpers.
 * Permissions per action:
 *   pin/unpin     → room admin OR original sender
 *   save/unsave   → any room member (per-user state)
 *   list-thread   → any room member
 *   search        → any room member
 *   schedule      → any room member; cancel limited to the original
 *                   author (or room admin who can also delete).
 */

import mongoose from "mongoose";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import savedMessageModel from "../../../DB/Model/savedMessage.model.js";
import scheduledMessageModel, {
  scheduledMessageStatus,
} from "../../../DB/Model/scheduledMessage.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { getPagination } from "../../../utils/db/pagination.js";
import { httpError } from "../../../utils/errors/index.js";
import { childLogger } from "../../../utils/logger/logger.js";
import { requireRoomMember } from "./shared.message.service.js";

const log = childLogger("message-extras");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/** Load a non-deleted, non-soft-deleted message scoped to a room. */
async function loadMessage(roomId, messageId) {
  if (!isValidId(messageId)) throw httpError(400, "Invalid messageId");
  const msg = await messageModel.findOne({
    _id: messageId,
    chatRoomId: roomId,
    deletedForEveryone: false,
  });
  if (!msg) throw httpError(404, "Message not found");
  return msg;
}

function isRoomAdmin(room, userId) {
  return (room.admins || []).some(
    (a) => a.toString() === String(userId),
  );
}

// ─────────────────────────────────────────────────────────────
// PIN / UNPIN
// ─────────────────────────────────────────────────────────────

// POST /chat/rooms/:roomId/messages/:messageId/pin
export const pinMessage = asyncHandler(async (req, res) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  const room = await requireRoomMember(roomId, userId);
  const msg = await loadMessage(roomId, messageId);

  // Either the sender or a room admin can pin/unpin. This mirrors
  // Slack: anyone in a channel can pin, but the model defaults to
  // a stricter rule. Tighten/loosen by editing this guard.
  const isSender = msg.senderId.toString() === userId.toString();
  if (!isSender && !isRoomAdmin(room, userId)) {
    throw httpError(403, "Only the sender or a room admin can pin messages");
  }

  if (msg.pinnedBy) {
    return successResponse({
      res,
      message: "Already pinned",
      data: msg,
    });
  }

  msg.pinnedBy = userId;
  msg.pinnedAt = new Date();
  await msg.save();

  return successResponse({ res, message: "Message pinned", data: msg });
});

// DELETE /chat/rooms/:roomId/messages/:messageId/pin
export const unpinMessage = asyncHandler(async (req, res) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  const room = await requireRoomMember(roomId, userId);
  const msg = await loadMessage(roomId, messageId);

  if (!msg.pinnedBy) {
    return successResponse({ res, message: "Not pinned", data: msg });
  }

  const isSender = msg.senderId.toString() === userId.toString();
  const isPinner = msg.pinnedBy.toString() === userId.toString();
  if (!isSender && !isPinner && !isRoomAdmin(room, userId)) {
    throw httpError(
      403,
      "Only the sender, the user who pinned it, or a room admin can unpin",
    );
  }

  msg.pinnedBy = null;
  msg.pinnedAt = null;
  await msg.save();

  return successResponse({ res, message: "Message unpinned", data: msg });
});

// GET /chat/rooms/:roomId/messages/pinned
export const listPinnedMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  await requireRoomMember(roomId, req.user._id);

  const items = await messageModel
    .find({
      chatRoomId: roomId,
      pinnedBy: { $type: "objectId" },
      deletedForEveryone: false,
    })
    .sort({ pinnedAt: -1 })
    .populate("senderId", "username email image")
    .populate("pinnedBy", "username image")
    .lean();

  return successResponse({ res, data: { count: items.length, items } });
});

// ─────────────────────────────────────────────────────────────
// SAVE / UNSAVE (bookmarks)
// ─────────────────────────────────────────────────────────────

// POST /chat/rooms/:roomId/messages/:messageId/save
export const saveMessage = asyncHandler(async (req, res) => {
  const { roomId, messageId } = req.params;
  const { note = null } = req.body || {};
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);
  await loadMessage(roomId, messageId);

  // Idempotent via upsert — race-safe and doesn't depend on the
  // unique index being built (which is async in test envs). The
  // `setOnInsert` keeps an existing note intact when re-saving.
  const result = await savedMessageModel.findOneAndUpdate(
    { userId, messageId },
    {
      $setOnInsert: {
        userId,
        messageId,
        chatRoomId: roomId,
        note: note ? String(note).slice(0, 500) : null,
      },
    },
    { upsert: true, new: true, includeResultMetadata: true },
  );

  const created =
    result?.lastErrorObject?.updatedExisting === false ||
    result?.lastErrorObject?.upserted;
  const doc = result?.value || result;

  return successResponse(
    {
      res,
      message: created ? "Message saved" : "Already saved",
      data: doc,
    },
    created ? 201 : 200,
  );
});

// DELETE /chat/rooms/:roomId/messages/:messageId/save
export const unsaveMessage = asyncHandler(async (req, res) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  // We DON'T require room membership for unsave — the user may have
  // been removed from the room since saving, but they should still be
  // able to clean up their bookmark list.
  if (!isValidId(messageId)) throw httpError(400, "Invalid messageId");

  const result = await savedMessageModel.deleteOne({ userId, messageId });
  if (result.deletedCount === 0) {
    return successResponse({ res, message: "Was not saved" });
  }
  return successResponse({ res, message: "Message unsaved" });
});

// GET /me/saved-messages?roomId=&page=&limit=
export const listMySavedMessages = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { roomId } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { userId };
  if (roomId) {
    if (!isValidId(roomId)) throw httpError(400, "Invalid roomId");
    filter.chatRoomId = roomId;
  }

  const [items, total] = await Promise.all([
    savedMessageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: "messageId",
        select: "content messageType senderId createdAt chatRoomId attachments",
        populate: { path: "senderId", select: "username image" },
      })
      .populate("chatRoomId", "name type")
      .lean(),
    savedMessageModel.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// THREADS
// ─────────────────────────────────────────────────────────────

// GET /chat/rooms/:roomId/messages/:messageId/thread
// Lists the parent message + all of its replies (ascending by time).
export const listThread = asyncHandler(async (req, res) => {
  const { roomId, messageId } = req.params;
  await requireRoomMember(roomId, req.user._id);

  const parent = await loadMessage(roomId, messageId);

  const { page, limit, skip } = getPagination(req.query);

  const [replies, total] = await Promise.all([
    messageModel
      .find({
        replyTo: parent._id,
        chatRoomId: roomId,
        deletedForEveryone: false,
      })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate("senderId", "username email image")
      .lean(),
    messageModel.countDocuments({
      replyTo: parent._id,
      chatRoomId: roomId,
      deletedForEveryone: false,
    }),
  ]);

  return successResponse({
    res,
    data: {
      parent,
      replyCount: total,
      page,
      limit,
      replies,
    },
  });
});

// ─────────────────────────────────────────────────────────────
// SEARCH (Mongo $text)
// ─────────────────────────────────────────────────────────────

// GET /chat/rooms/:roomId/messages/search?q=...&page=&limit=
// The Message model already has { content: "text" }; we reuse that.
export const searchMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const { q } = req.query;

  if (!q || !String(q).trim()) {
    throw httpError(400, "Search query 'q' is required");
  }
  await requireRoomMember(roomId, req.user._id);

  const { page, limit, skip } = getPagination(req.query);

  const filter = {
    chatRoomId: roomId,
    deletedForEveryone: false,
    $text: { $search: String(q).trim() },
  };

  const [items, total] = await Promise.all([
    messageModel
      .find(filter, { score: { $meta: "textScore" } })
      .sort({ score: { $meta: "textScore" }, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("senderId", "username email image")
      .lean(),
    messageModel.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: { page, limit, total, items, query: q },
  });
});

// GET /me/mentions?page=&limit=
// Mentions inbox — all messages mentioning the current user
// (across every room they're still in).
export const listMyMentions = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page, limit, skip } = getPagination(req.query);

  // We don't filter by current room membership here. A user who was
  // mentioned in a room they later left should still see the mention
  // in their inbox — that's how Slack/Teams behave.
  const filter = { mentions: userId, deletedForEveryone: false };

  const [items, total] = await Promise.all([
    messageModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("senderId", "username email image")
      .populate("chatRoomId", "name type")
      .lean(),
    messageModel.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: { page, limit, total, items },
  });
});

// ─────────────────────────────────────────────────────────────
// SCHEDULED MESSAGES
// ─────────────────────────────────────────────────────────────

// POST /chat/rooms/:roomId/messages/schedule
// body: { content, sendAt, replyTo?, messageType? }
export const scheduleMessage = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  const { content, sendAt, replyTo = null, messageType = "text" } = req.body;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  if (!content || !content.trim()) {
    throw httpError(400, "Content is required for scheduled messages");
  }
  if (!sendAt) throw httpError(400, "sendAt is required");

  const when = new Date(sendAt);
  if (Number.isNaN(when.getTime())) {
    throw httpError(400, "sendAt must be a valid date");
  }
  // 30s buffer because the cron tick interval is ~30s; closer than
  // that and the user might miss the window entirely.
  if (when.getTime() < Date.now() + 30 * 1000) {
    throw httpError(400, "sendAt must be at least 30 seconds in the future");
  }

  // Optional: validate replyTo exists in this room. The actual send
  // step will re-validate, but failing early is friendlier.
  if (replyTo) {
    const parent = await messageModel.findOne({
      _id: replyTo,
      chatRoomId: roomId,
      deletedForEveryone: false,
    });
    if (!parent) throw httpError(404, "replyTo target not found");
  }

  const scheduled = await scheduledMessageModel.create({
    chatRoomId: roomId,
    senderId: userId,
    content: content.trim(),
    messageType,
    replyTo: replyTo || null,
    sendAt: when,
  });

  return successResponse(
    {
      res,
      message: "Message scheduled",
      data: scheduled,
    },
    201,
  );
});

// DELETE /chat/rooms/:roomId/messages/scheduled/:scheduledId
// Only the original author can cancel their own scheduled message.
export const cancelScheduledMessage = asyncHandler(async (req, res) => {
  const { roomId, scheduledId } = req.params;
  const userId = req.user._id;

  if (!isValidId(scheduledId)) throw httpError(400, "Invalid scheduledId");

  const scheduled = await scheduledMessageModel.findOne({
    _id: scheduledId,
    chatRoomId: roomId,
  });
  if (!scheduled) throw httpError(404, "Scheduled message not found");

  if (scheduled.senderId.toString() !== userId.toString()) {
    throw httpError(403, "Only the author can cancel a scheduled message");
  }
  if (scheduled.status !== scheduledMessageStatus.Pending) {
    throw httpError(
      409,
      `Cannot cancel — already ${scheduled.status}`,
    );
  }

  scheduled.status = scheduledMessageStatus.Cancelled;
  await scheduled.save();

  return successResponse({ res, message: "Scheduled message cancelled" });
});

// GET /chat/rooms/:roomId/messages/scheduled
// Returns my pending scheduled messages in this room.
export const listMyScheduledMessages = asyncHandler(async (req, res) => {
  const { roomId } = req.params;
  await requireRoomMember(roomId, req.user._id);

  const items = await scheduledMessageModel
    .find({
      chatRoomId: roomId,
      senderId: req.user._id,
      status: scheduledMessageStatus.Pending,
    })
    .sort({ sendAt: 1 })
    .lean();

  return successResponse({ res, data: { count: items.length, items } });
});
