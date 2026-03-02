import chatModel from "../../../DB/model/chat.model.js";
import companyModel from "../../../DB/model/company.model.js";
import { socketConnection } from "../../../DB/Model/user.model"
import { authentication } from "../../../middleware/socket/auth.middleware.js";
import * as dbService from "../../../DB/db.service.js";

export const sendMessage = (socket) => {
  return socket.on("sendMessage", async (messageData) => {
    const { data, valid } = await authentication({ socket });
    if (!valid) {
      return socket.emit("socket_Error", data);
    }

    const userId = data.user._id;
    const { message, destId } = messageData;

    let chat = await dbService.findOneAndUpdate({
      model: chatModel,
      filter: {
        $or: [
          { senderId: userId, receiverId: destId },
          { senderId: destId, receiverId: userId },
        ],
      },
      data: {
        $push: { messages: { message, senderId: userId } },
      },
      populate: [
        { path: "senderId", select: "firstName lastName profilePic image" },
        { path: "receiverId", select: "firstName lastName profilePic image" },
        {
          path: "messages.senderId",
          select: "firstName lastName profilePic image",
        },
      ],
    });
    if (!chat) {
      const companies = await dbService.find({
        model: companyModel,
        filter: { $or: [{ createdBy: userId }, { HRs: userId }] },
      });

      if (!companies.length) {
        return socket.emit("socket_Error", {
          message: "You are not allowed to start chat with this user",
          status: 403,
        });
      }

      chat = await dbService.create({
        model: chatModel,
        data: {
          senderId: userId,
          receiverId: destId,
          messages: [{ message, senderId: userId }],
        },
      });

      chat = await dbService.findOne({
        model: chatModel,
        filter: { _id: chat._id },
        populate: [
          { path: "senderId", select: "firstName lastName profilePic image" },
          { path: "receiverId", select: "firstName lastName profilePic image" },
          {
            path: "messages.senderId",
            select: "firstName lastName profilePic image",
          },
        ],
      });
    }

    socket.emit("successMessage", { chat, message });
    socket
      .to(socketConnection.get(destId))
      .emit("receiveMessage", { chat, message });

    return "Done";
  });
};
