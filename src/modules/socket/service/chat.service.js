import { authentication } from "../../../middleware/socket/auth.middleware.js";
import * as dbService from "../../../DB/db.service.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import userModel from "../../../DB/Model/user.model.js";
import { successResponse } from "../../../utils/response/success.response.js";
import {asyncHandler} from "../../../utils/response/error.response.js";


export const sendMessage = asyncHandler(async (req, res, next) => {
  console.log("Updated sendMessage running");
  const { chatRoomId, content, replyTo, mentions } = req.body;

  const chatRoom = await dbService.findOne({
    model: chatRoomModel,
    filter: { _id: chatRoomId, members: req.user._id },
  });
  if (!chatRoom) return next(new Error("Chat room not found", { cause: 404 }));

  const parsedMentions =
    mentions || content.match(/@(\w+)/g)?.map((m) => m.slice(1)) || [];
  const mentionUsers = await dbService.find({
    model: userModel,
    filter: {
      username: { $in: parsedMentions },
      teams: { $in: req.user.teams },
    },
  });

  const message = await dbService.create({
    model: messageModel,
    data: {
      content,
      chatRoom: chatRoomId,
      sender: req.user._id,
      replyTo,
      mentions: mentionUsers.map((u) => u._id),
    },
  });

  // Temporary: Just update lastMessage (remove unreadCounts for now)
  await dbService.updateOne({
    model: chatRoomModel,
    filter: { _id: chatRoomId },
    data: { lastMessage: message._id },
  });

  return successResponse({ res, data: { message } });
});

export const handleTyping = (socket, io) => {
  socket.on("typingStart", async (chatRoomId) => {
    const { data: auth, valid } = await authentication({ socket });
    if (!valid) return;

    await dbService.updateOne({
      model: chatRoomModel,
      filter: { _id: chatRoomId },
      data: {
        $addToSet: {
          typingUsers: { user: auth.user._id, timestamp: new Date() },
        },
      },
    });

    socket
      .to(chatRoomId)
      .emit("userTyping", { userId: auth.user._id, typing: true });
  });

  socket.on("typingStop", async (chatRoomId) => {
    const { data: auth, valid } = await authentication({ socket });
    if (!valid) return;

    await dbService.updateOne({
      model: chatRoomModel,
      filter: { _id: chatRoomId },
      data: { $pull: { typingUsers: { user: auth.user._id } } },
    });

    socket
      .to(chatRoomId)
      .emit("userTyping", { userId: auth.user._id, typing: false });
  });
};

export const handleReaction = (socket, io) => {
  socket.on("addReaction", async (data) => {
    const { data: auth, valid } = await authentication({ socket });
    if (!valid) return socket.emit("error", auth);

    const { messageId, emoji } = data;
    const message = await dbService.findOne({
      model: messageModel,
      filter: { _id: messageId, chatRoom: { $in: auth.user.chatRooms,  } },
    });
    if (!message) return socket.emit("error", { message: "Message not found" });

    const reaction = message.reactions.find((r) => r.emoji === emoji);
    if (reaction) {
      if (reaction.users.includes(auth.user._id)) {
        reaction.users.pull(auth.user._id);
      } else {
        reaction.users.push(auth.user._id);
      }
    } else {
      message.reactions.push({ emoji, users: [auth.user._id] });
    }

    await message.save();
    io.to(data.chatRoomId).emit("reactionUpdated", {
      messageId,
      emoji,
      userId: auth.user._id,
    });
  });
};
