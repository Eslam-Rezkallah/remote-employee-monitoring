import messageModel from "../../../DB/Model/message.model.js";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import fileModel from "../../../DB/Model/file.model.js";
import { cloud } from "../../../utils/multer/cloudinary.multer.js";
import { getUserSocketIds } from "./store/onlineUsers.store.js";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const getRoomAndCheckAccess = async (roomId, userId) => {
  const room = await chatRoomModel.findById(roomId);
  if (!room) return { error: { message: "Chat room not found", status: 404 } };
  const isMember = room.members.map((m) => m.toString()).includes(userId);
  if (!isMember) return { error: { message: "Access denied", status: 403 } };
  return { room };
};

const populateMessage = (query) =>
  query
    .populate("sender", "username image")
    .populate("mentions", "username image")
    .populate("attachments")
    .populate({
      path: "replyTo",
      populate: { path: "sender", select: "username image" },
    })
    .populate({
      path: "threadReplies",
      populate: { path: "sender", select: "username image" },
    });

// ─────────────────────────────────────────────
// SEND MESSAGE
// ─────────────────────────────────────────────

export const sendMessage = (io, socket) => {
  socket.on(
    "message:send",
    async ({
      roomId,
      content,
      replyToId,
      mentionIds = [],
      attachmentIds = [],
    }) => {
      try {
        const userId = socket.userId;
        const { room, error } = await getRoomAndCheckAccess(roomId, userId);
        if (error) return socket.emit("socket_error", error);

        if (!content && attachmentIds.length === 0) {
          return socket.emit("socket_error", {
            message: "Message cannot be empty",
            status: 400,
          });
        }

        // Build message
        const msgData = {
          content: content || "",
          chatRoom: roomId,
          sender: userId,
          mentions: mentionIds,
          attachments: attachmentIds,
          status: "sent",
        };

        if (replyToId) {
          const replyMsg = await messageModel.findById(replyToId);
          if (replyMsg && replyMsg.chatRoom.toString() === roomId) {
            msgData.replyTo = replyToId;
          }
        }

        let message = await messageModel.create(msgData);
        message = await populateMessage(messageModel.findById(message._id));

        // Update room lastMessage and unread counts
        const bulkOps = room.members
          .filter((m) => m.toString() !== userId)
          .map((memberId) => ({
            updateOne: {
              filter: { _id: roomId, "unreadCounts.user": memberId },
              update: { $inc: { "unreadCounts.$.count": 1 } },
            },
          }));

        await Promise.all([
          chatRoomModel.findByIdAndUpdate(roomId, {
            lastMessage: message._id,
          }),
          bulkOps.length ? chatRoomModel.bulkWrite(bulkOps) : Promise.resolve(),
        ]);

        // Emit to everyone in the room
        io.to(`room:${roomId}`).emit("message:new", { message });

        // Deliver status update for members not in room socket
        room.members.forEach((memberId) => {
          const memberIdStr = memberId.toString();
          if (memberIdStr !== userId) {
            const sockets = getUserSocketIds(memberIdStr);
            if (sockets.length) {
              // User is online → mark delivered
              io.to(`user:${memberIdStr}`).emit("message:delivered", {
                messageId: message._id,
                roomId,
              });
            }
          }
        });
      } catch (err) {
        console.error("sendMessage error:", err);
        socket.emit("socket_error", { message: "Server error", status: 500 });
      }
    },
  );
};

// ─────────────────────────────────────────────
// GET MESSAGES (paginated)
// ─────────────────────────────────────────────

export const getMessages = (io, socket) => {
  socket.on("message:getAll", async ({ roomId, page = 1, limit = 30 }) => {
    try {
      const userId = socket.userId;
      const { error } = await getRoomAndCheckAccess(roomId, userId);
      if (error) return socket.emit("socket_error", error);

      const skip = (page - 1) * limit;

      const [messages, total] = await Promise.all([
        populateMessage(
          messageModel
            .find({ chatRoom: roomId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),
        ),
        messageModel.countDocuments({ chatRoom: roomId }),
      ]);

      // Reset unread count for this user
      await chatRoomModel.updateOne(
        { _id: roomId, "unreadCounts.user": userId },
        { $set: { "unreadCounts.$.count": 0 } },
      );

      socket.emit("message:all", {
        messages: messages.reverse(),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasMore: skip + messages.length < total,
        },
      });
    } catch (err) {
      console.error("getMessages error:", err);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

// ─────────────────────────────────────────────
// EDIT MESSAGE (within 1 hour)
// ─────────────────────────────────────────────

export const editMessage = (io, socket) => {
  socket.on("message:edit", async ({ messageId, newContent }) => {
    try {
      const userId = socket.userId;
      const message = await messageModel.findById(messageId);

      if (!message) {
        return socket.emit("socket_error", {
          message: "Message not found",
          status: 404,
        });
      }

      if (message.sender.toString() !== userId) {
        return socket.emit("socket_error", {
          message: "You can only edit your own messages",
          status: 403,
        });
      }

      // Check 1-hour window
      const oneHour = 60 * 60 * 1000;
      if (Date.now() - message.createdAt.getTime() > oneHour) {
        return socket.emit("socket_error", {
          message: "Cannot edit message after 1 hour",
          status: 400,
        });
      }

      if (!newContent || !newContent.trim()) {
        return socket.emit("socket_error", {
          message: "Content cannot be empty",
          status: 400,
        });
      }

      message.content = newContent.trim();
      message.isEdited = true;
      message.editedAt = new Date();
      await message.save();

      const updated = await populateMessage(messageModel.findById(messageId));

      io.to(`room:${message.chatRoom}`).emit("message:edited", {
        message: updated,
      });
    } catch (err) {
      console.error("editMessage error:", err);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

// ─────────────────────────────────────────────
// DELETE MESSAGE (only sender, within 1 hour)
// ─────────────────────────────────────────────

export const deleteMessage = (io, socket) => {
  socket.on("message:delete", async ({ messageId }) => {
    try {
      const userId = socket.userId;
      const message = await messageModel.findById(messageId);

      if (!message) {
        return socket.emit("socket_error", {
          message: "Message not found",
          status: 404,
        });
      }

      if (message.sender.toString() !== userId) {
        return socket.emit("socket_error", {
          message: "You can only delete your own messages",
          status: 403,
        });
      }

      // Check 1-hour window
      const oneHour = 60 * 60 * 1000;
      if (Date.now() - message.createdAt.getTime() > oneHour) {
        return socket.emit("socket_error", {
          message: "Cannot delete message after 1 hour",
          status: 400,
        });
      }

      const roomId = message.chatRoom.toString();
      await messageModel.findByIdAndDelete(messageId);

      // If this was lastMessage, update room's lastMessage
      const room = await chatRoomModel.findById(roomId);
      if (room?.lastMessage?.toString() === messageId) {
        const prevMessage = await messageModel
          .findOne({ chatRoom: roomId })
          .sort({ createdAt: -1 });
        await chatRoomModel.findByIdAndUpdate(roomId, {
          lastMessage: prevMessage?._id || null,
        });
      }

      io.to(`room:${roomId}`).emit("message:deleted", { messageId, roomId });
    } catch (err) {
      console.error("deleteMessage error:", err);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

// ─────────────────────────────────────────────
// MESSAGE SEEN
// ─────────────────────────────────────────────

export const markAsSeen = (io, socket) => {
  socket.on("message:seen", async ({ roomId, messageId }) => {
    try {
      const userId = socket.userId;

      // Mark message as seen
      await messageModel.findByIdAndUpdate(messageId, { status: "seen" });

      // Reset unread count
      await chatRoomModel.updateOne(
        { _id: roomId, "unreadCounts.user": userId },
        { $set: { "unreadCounts.$.count": 0 } },
      );

      // Notify the room (especially sender)
      io.to(`room:${roomId}`).emit("message:seen", {
        messageId,
        roomId,
        seenBy: userId,
        seenAt: new Date(),
      });
    } catch (err) {
      console.error("markAsSeen error:", err);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

// ─────────────────────────────────────────────
// TYPING INDICATOR
// ─────────────────────────────────────────────

export const typingIndicator = (io, socket) => {
  socket.on("message:typing", ({ roomId }) => {
    socket.to(`room:${roomId}`).emit("message:typing", {
      userId: socket.userId,
      roomId,
    });
  });

  socket.on("message:stopTyping", ({ roomId }) => {
    socket.to(`room:${roomId}`).emit("message:stopTyping", {
      userId: socket.userId,
      roomId,
    });
  });
};

// ─────────────────────────────────────────────
// REACTIONS
// ─────────────────────────────────────────────

export const reactToMessage = (io, socket) => {
  socket.on("message:react", async ({ messageId, emoji }) => {
    try {
      const userId = socket.userId;
      const message = await messageModel.findById(messageId);

      if (!message) {
        return socket.emit("socket_error", {
          message: "Message not found",
          status: 404,
        });
      }

      const reactionIndex = message.reactions.findIndex(
        (r) => r.emoji === emoji,
      );

      if (reactionIndex === -1) {
        // New emoji reaction
        message.reactions.push({ emoji, users: [userId] });
      } else {
        const userIndex = message.reactions[reactionIndex].users
          .map((u) => u.toString())
          .indexOf(userId);

        if (userIndex === -1) {
          // User hasn't reacted with this emoji yet
          message.reactions[reactionIndex].users.push(userId);
        } else {
          // Toggle off - remove user's reaction
          message.reactions[reactionIndex].users.splice(userIndex, 1);
          if (message.reactions[reactionIndex].users.length === 0) {
            message.reactions.splice(reactionIndex, 1);
          }
        }
      }

      await message.save();
      const updated = await populateMessage(messageModel.findById(messageId));

      io.to(`room:${message.chatRoom}`).emit("message:reacted", {
        message: updated,
      });
    } catch (err) {
      console.error("reactToMessage error:", err);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

// ─────────────────────────────────────────────
// PIN MESSAGE
// ─────────────────────────────────────────────

export const pinMessage = (io, socket) => {
  socket.on("message:pin", async ({ messageId, roomId }) => {
    try {
      const userId = socket.userId;
      const { room, error } = await getRoomAndCheckAccess(roomId, userId);
      if (error) return socket.emit("socket_error", error);

      const message = await messageModel.findById(messageId);
      if (!message || message.chatRoom.toString() !== roomId) {
        return socket.emit("socket_error", {
          message: "Message not found in this room",
          status: 404,
        });
      }

      const isPinned = !message.isPinned;
      message.isPinned = isPinned;
      message.pinnedBy = isPinned ? userId : null;
      message.pinnedAt = isPinned ? new Date() : null;
      await message.save();

      const updated = await populateMessage(messageModel.findById(messageId));

      io.to(`room:${roomId}`).emit("message:pinned", {
        message: updated,
        isPinned,
        pinnedBy: userId,
      });
    } catch (err) {
      console.error("pinMessage error:", err);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};

// ─────────────────────────────────────────────
// SEARCH MESSAGES
// ─────────────────────────────────────────────

export const searchMessages = (io, socket) => {
  socket.on(
    "message:search",
    async ({ roomId, query, page = 1, limit = 20 }) => {
      try {
        const userId = socket.userId;
        const { error } = await getRoomAndCheckAccess(roomId, userId);
        if (error) return socket.emit("socket_error", error);

        if (!query || !query.trim()) {
          return socket.emit("socket_error", {
            message: "Search query required",
            status: 400,
          });
        }

        const skip = (page - 1) * limit;

        const [messages, total] = await Promise.all([
          populateMessage(
            messageModel
              .find({
                chatRoom: roomId,
                content: { $regex: query.trim(), $options: "i" },
              })
              .sort({ createdAt: -1 })
              .skip(skip)
              .limit(limit),
          ),
          messageModel.countDocuments({
            chatRoom: roomId,
            content: { $regex: query.trim(), $options: "i" },
          }),
        ]);

        socket.emit("message:searchResults", {
          messages,
          query,
          pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
            hasMore: skip + messages.length < total,
          },
        });
      } catch (err) {
        console.error("searchMessages error:", err);
        socket.emit("socket_error", { message: "Server error", status: 500 });
      }
    },
  );
};

// ─────────────────────────────────────────────
// THREAD REPLIES
// ─────────────────────────────────────────────

export const threadReply = (io, socket) => {
  socket.on(
    "message:threadReply",
    async ({ parentMessageId, content, attachmentIds = [] }) => {
      try {
        const userId = socket.userId;
        const parentMessage = await messageModel.findById(parentMessageId);

        if (!parentMessage) {
          return socket.emit("socket_error", {
            message: "Parent message not found",
            status: 404,
          });
        }

        const { error } = await getRoomAndCheckAccess(
          parentMessage.chatRoom.toString(),
          userId,
        );
        if (error) return socket.emit("socket_error", error);

        let reply = await messageModel.create({
          content: content || "",
          chatRoom: parentMessage.chatRoom,
          sender: userId,
          replyTo: parentMessageId,
          attachments: attachmentIds,
          isThreadReply: true,
        });

        reply = await populateMessage(messageModel.findById(reply._id));

        // Push to parent's threadReplies
        await messageModel.findByIdAndUpdate(parentMessageId, {
          $push: { threadReplies: reply._id },
        });

        const updatedParent = await populateMessage(
          messageModel.findById(parentMessageId),
        );

        io.to(`room:${parentMessage.chatRoom}`).emit("message:threadReply", {
          reply,
          parentMessage: updatedParent,
        });
      } catch (err) {
        console.error("threadReply error:", err);
        socket.emit("socket_error", { message: "Server error", status: 500 });
      }
    },
  );
};

// ─────────────────────────────────────────────
// GET PINNED MESSAGES
// ─────────────────────────────────────────────

export const getPinnedMessages = (io, socket) => {
  socket.on("message:getPinned", async ({ roomId }) => {
    try {
      const userId = socket.userId;
      const { error } = await getRoomAndCheckAccess(roomId, userId);
      if (error) return socket.emit("socket_error", error);

      const pinned = await populateMessage(
        messageModel
          .find({ chatRoom: roomId, isPinned: true })
          .sort({ pinnedAt: -1 }),
      );

      socket.emit("message:pinned_list", { messages: pinned });
    } catch (err) {
      console.error("getPinnedMessages error:", err);
      socket.emit("socket_error", { message: "Server error", status: 500 });
    }
  });
};
