import reactionModel from "../../../DB/Model/reaction.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { httpError } from "../../../utils/errors/index.js";

/* ============================================================
   Shared helper
============================================================ */
async function requireRoomMember(roomId, userId) {
  const room = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: roomId, members: userId, isDeleted: false },
  });
  if (!room)
    throw httpError(404, "Room not found or access denied");
  return room;
}

/* ============================================================
   POST /chat/rooms/:roomId/messages/:messageId/reactions
   Add or change a reaction (one per user per message)
============================================================ */
export const addReaction = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;
  const { reaction } = req.body;

  await requireRoomMember(roomId, userId);

  // Ensure message belongs to this room
  const message = await dbService.findOne({
    model: messageModel,
    filter: { _id: messageId, chatRoomId: roomId, deletedForEveryone: false },
  });
  if (!message) return next(httpError(404, "Message not found"));

  // Upsert: one reaction per user per message
  const existing = await dbService.findOne({
    model: reactionModel,
    filter: { messageId, userId },
  });

  let reactionDoc;
  if (existing) {
    // Update emoji if different
    if (existing.reaction === reaction) {
      return successResponse({
        res,
        data: { reaction: existing },
        message: "Reaction unchanged",
      });
    }
    reactionDoc = await dbService.findOneAndUpdate({
      model: reactionModel,
      filter: { messageId, userId },
      data: { reaction },
      options: { new: true },
      populate: [{ path: "userId", select: "username image" }],
    });
  } else {
    reactionDoc = await dbService.create({
      model: reactionModel,
      data: { messageId, chatRoomId: roomId, userId, reaction },
    });
    // Push reference into message.reactions
    await dbService.updateOne({
      model: messageModel,
      filter: { _id: messageId },
      data: { $addToSet: { reactions: reactionDoc._id } },
    });
    await reactionModel.populate(reactionDoc, {
      path: "userId",
      select: "username image",
    });
  }

  // Build summary for the response (counts per emoji)
  const summary = await reactionModel.aggregate([
    { $match: { messageId: message._id } },
    { $group: { _id: "$reaction", count: { $sum: 1 } } },
    { $project: { reaction: "$_id", count: 1, _id: 0 } },
  ]);

  return successResponse(
    {
      res,
      data: { reaction: reactionDoc, summary },
      message: "Reaction added",
    },
    201,
  );
});

/* ============================================================
   DELETE /chat/rooms/:roomId/messages/:messageId/reactions
   Remove the requesting user's reaction from a message
============================================================ */
export const removeReaction = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const reactionDoc = await dbService.findOne({
    model: reactionModel,
    filter: { messageId, userId },
  });

  if (!reactionDoc) {
    return next(httpError(404, "Reaction not found"));
  }

  await dbService.deleteOne({
    model: reactionModel,
    filter: { _id: reactionDoc._id },
  });

  // Remove reference from message
  await dbService.updateOne({
    model: messageModel,
    filter: { _id: messageId },
    data: { $pull: { reactions: reactionDoc._id } },
  });

  // Updated summary
  const summary = await reactionModel.aggregate([
    { $match: { messageId: reactionDoc.messageId } },
    { $group: { _id: "$reaction", count: { $sum: 1 } } },
    { $project: { reaction: "$_id", count: 1, _id: 0 } },
  ]);

  return successResponse({
    res,
    data: { summary },
    message: "Reaction removed",
  });
});

/* ============================================================
   GET /chat/rooms/:roomId/messages/:messageId/reactions
   List all reactions for a message with counts
============================================================ */
export const listReactions = asyncHandler(async (req, res, next) => {
  const { roomId, messageId } = req.params;
  const userId = req.user._id;

  await requireRoomMember(roomId, userId);

  const reactions = await reactionModel
    .find({ messageId })
    .populate("userId", "username image")
    .sort({ createdAt: 1 })
    .lean();

  // Group by emoji for summary
  const summary = reactions.reduce((acc, r) => {
    const key = r.reaction;
    if (!acc[key]) acc[key] = { reaction: key, count: 0, users: [] };
    acc[key].count++;
    acc[key].users.push({
      _id: r.userId._id,
      username: r.userId.username,
      image: r.userId.image,
    });
    return acc;
  }, {});

  return successResponse({
    res,
    data: {
      reactions,
      summary: Object.values(summary),
      myReaction:
        reactions.find((r) => r.userId._id.toString() === userId.toString())
          ?.reaction || null,
    },
  });
});
