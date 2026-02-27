import { asyncHandler } from "../../../utils/response/error.response.js";
import * as dbService from "../../../DB/db.service.js";
import { successResponse } from "../../../utils/response/success.response.js";
import chatModel from "../../../DB/model/chat.model.js";

export const getChatHistory = asyncHandler(async (req, res, next) => {
  const { receiverId } = req.params;
  const chat = await dbService.findOne({
    model: chatModel,
    filter: {
      $or: [
        { senderId: req.user.id, receiverId: receiverId },
        { senderId: receiverId, receiverId: req.user.id },
      ],
    },
    populate: [
      { path: "senderId", select: "firstName lastName image" },
      { path: "receiverId", select: "firstName lastName image" },
      { path: "messages.senderId", select: "firstName lastName image" },
    ],
  });

  return successResponse({
    res,
    data: { chat },
  });
});

export const getMyChats = asyncHandler(async (req, res, next) => {
  const myId = req.user.id;

  const chats = await dbService.find({
    model: chatModel,
    filter: {
      $or: [{ senderId: myId }, { receiverId: myId }],
    },
    populate: [
      { path: "senderId", select: "firstName lastName image" },
      { path: "receiverId", select: "firstName lastName image" },
      { path: "messages.senderId", select: "firstName lastName image" },
    ],
  });

  return successResponse({ res, data: { chats } });
});
