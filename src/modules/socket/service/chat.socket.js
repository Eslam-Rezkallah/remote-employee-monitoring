import mongoose from "mongoose";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import reactionModel, {
  validReactions,
} from "../../../DB/Model/reaction.model.js";
import { socketConnection } from "../../../DB/Model/user.model.js";
import { authentication } from "../../../middleware/socket/auth.middleware.js";

/* ============================================================
   Constants
============================================================ */
const EDIT_WINDOW_MS = 60 * 60 * 1000;
const DELETE_WINDOW_MS = 60 * 60 * 1000;

const EVENTS = {
  CONNECT: "connection",
  DISCONNECT: "disconnect",
  SOCKET_ERROR: "socket_Error",

  JOIN_ROOM: "join_room",
  LEAVE_ROOM: "leave_room",
  ROOM_JOINED: "room_joined",
  ROOM_LEFT: "room_left",

  SEND_MESSAGE: "send_message",
  RECEIVE_MESSAGE: "receive_message",
  MESSAGE_SENT: "message_sent",

  TYPING: "typing",
  STOP_TYPING: "stop_typing",
  USER_TYPING: "user_typing",
  USER_STOPPED_TYPING: "user_stopped_typing",

  MESSAGE_DELIVERED: "message_delivered",
  MESSAGE_SEEN: "message_seen",
  MESSAGES_SEEN: "messages_seen",

  ADD_REACTION: "add_reaction",
  REMOVE_REACTION: "remove_reaction",
  REACTION_ADDED: "reaction_added",
  REACTION_REMOVED: "reaction_removed",

  EDIT_MESSAGE: "edit_message",
  DELETE_MESSAGE: "delete_message",
  MESSAGE_EDITED: "message_edited",
  MESSAGE_DELETED: "message_deleted",

  USER_ONLINE: "user_online",
  USER_OFFLINE: "user_offline",
  GET_ONLINE_USERS: "get_online_users",
  ONLINE_USERS: "online_users",

  // ✅ NEW: Feature 5 — Room creation broadcast
  ROOM_CREATED: "room_created",

  // ✅ NEW: Feature 7 — Delivery status for checkmarks
  MESSAGE_DELIVERY_STATUS: "message_delivery_status",
};

/* ============================================================
   Presence Helpers
============================================================ */
function markUserOnline(userId, socketId) {
  const key = userId.toString();
  const existing = socketConnection.get(key);
  if (existing instanceof Set) {
    existing.add(socketId);
  } else {
    const prev = existing ? new Set([existing]) : new Set();
    prev.add(socketId);
    socketConnection.set(key, prev);
  }
}

function markUserOffline(userId, socketId) {
  const key = userId.toString();
  const val = socketConnection.get(key);
  if (val instanceof Set) {
    val.delete(socketId);
    if (val.size === 0) socketConnection.delete(key);
  } else if (val === socketId) {
    socketConnection.delete(key);
  }
}

function isUserOnline(userId) {
  const val = socketConnection.get(userId.toString());
  if (val instanceof Set) return val.size > 0;
  return !!val;
}

function emitError(socket, event, message, code = 400) {
  socket.emit(EVENTS.SOCKET_ERROR, { event, message, code });
}

async function isRoomMember(roomId, userId) {
  if (!mongoose.Types.ObjectId.isValid(roomId)) return false;
  const room = await chatRoomModel
    .findOne({ _id: roomId, members: userId, isDeleted: false })
    .lean();
  return !!room;
}

/* ============================================================
   ✅ NEW: Helper to broadcast room creation to all members
   Feature 5: Socket event for room creation
============================================================ */
function broadcastRoomCreated(namespace, room) {
  if (!room || !room.members) return;

  room.members.forEach((memberId) => {
    const memberIdStr = memberId.toString
      ? memberId.toString()
      : String(memberId);
    // Emit to every member's personal room
    namespace.to(`user_${memberIdStr}`).emit(EVENTS.ROOM_CREATED, {
      room: {
        _id: room._id,
        name: room.name,
        type: room.type,
        members: room.members,
        createdBy: room.createdBy,
        lastMessage: null,
        lastMessageAt: null,
        createdAt: room.createdAt,
      },
    });
  });
}

/* ============================================================
   ✅ NEW: Helper to compute delivery status for a message
   Feature 7: Checkmarks (sent → delivered → seen)
============================================================ */
function getDeliveryStatus(message, roomMemberCount) {
  if (!message) return "sent";

  const deliveredCount = message.deliveredTo?.length || 0;
  const seenCount = message.seenBy?.length || 0;
  const otherMembers = Math.max((roomMemberCount || 1) - 1, 1);

  if (seenCount >= otherMembers) return "seen_all";
  if (seenCount > 0) return "seen_partial";
  if (deliveredCount >= otherMembers) return "delivered_all";
  if (deliveredCount > 0) return "delivered_partial";
  return "sent";
}

/* ============================================================
   registerChatSocket
============================================================ */
export const registerChatSocket = (namespace) => {
  // ── Auth middleware ──────────────────────────────────────────
  namespace.use(async (socket, next) => {
    const { data, valid } = await authentication({ socket });
    if (!valid) {
      return next(new Error(data?.message || "Unauthorized"));
    }
    socket.user = data.user;
    return next();
  });

  // ── Handle connections ──────────────────────────────────────
  namespace.on(EVENTS.CONNECT, async (socket) => {
    const user = socket.user;
    const userId = user._id.toString();

    console.log(`[Chat Socket] Connected: ${user.username} (${userId})`);

    markUserOnline(userId, socket.id);

    // ✅ Join personal room for DM notifications + room creation broadcasts
    socket.join(`user_${userId}`);

    try {
      const rooms = await chatRoomModel
        .find({ members: userId, isDeleted: false })
        .select("_id")
        .lean();

      rooms.forEach((r) => socket.join(`room:${r._id}`));

      socket.broadcast.emit(EVENTS.USER_ONLINE, {
        userId,
        username: user.username,
        image: user.image,
      });
    } catch (err) {
      console.error("[Chat Socket] Error auto-joining rooms:", err.message);
    }

    /* ----------------------------------------------------------
       JOIN_ROOM
    ---------------------------------------------------------- */
    socket.on(EVENTS.JOIN_ROOM, async ({ roomId }) => {
      try {
        if (!roomId)
          return emitError(socket, EVENTS.JOIN_ROOM, "roomId is required");

        const isMember = await isRoomMember(roomId, userId);
        if (!isMember)
          return emitError(socket, EVENTS.JOIN_ROOM, "Access denied", 403);

        socket.join(`room:${roomId}`);

        // Mark undelivered messages as delivered
        const deliverResult = await messageModel.updateMany(
          {
            chatRoomId: roomId,
            "deliveredTo.userId": { $ne: userId },
            senderId: { $ne: userId },
          },
          { $addToSet: { deliveredTo: { userId, deliveredAt: new Date() } } },
        );

        socket.emit(EVENTS.ROOM_JOINED, { roomId });

        // ✅ IMPROVED: Broadcast delivery status with count
        if (deliverResult.modifiedCount > 0) {
          socket.to(`room:${roomId}`).emit(EVENTS.MESSAGE_DELIVERED, {
            roomId,
            userId,
            username: user.username,
            count: deliverResult.modifiedCount,
          });
        }
      } catch (err) {
        emitError(socket, EVENTS.JOIN_ROOM, err.message);
      }
    });

    /* ----------------------------------------------------------
       LEAVE_ROOM
    ---------------------------------------------------------- */
    socket.on(EVENTS.LEAVE_ROOM, ({ roomId }) => {
      if (!roomId)
        return emitError(socket, EVENTS.LEAVE_ROOM, "roomId is required");
      socket.leave(`room:${roomId}`);
      socket.emit(EVENTS.ROOM_LEFT, { roomId });
    });

    /* ----------------------------------------------------------
       SEND_MESSAGE
    ---------------------------------------------------------- */
    socket.on(EVENTS.SEND_MESSAGE, async (payload) => {
      try {
        const {
          roomId,
          content = "",
          messageType = "text",
          replyTo,
        } = payload || {};

        if (!roomId)
          return emitError(socket, EVENTS.SEND_MESSAGE, "roomId is required");
        if (!content.trim())
          return emitError(
            socket,
            EVENTS.SEND_MESSAGE,
            "Message content cannot be empty",
          );

        const isMember = await isRoomMember(roomId, userId);
        if (!isMember)
          return emitError(socket, EVENTS.SEND_MESSAGE, "Access denied", 403);

        if (replyTo && mongoose.Types.ObjectId.isValid(replyTo)) {
          const parent = await messageModel.findOne({
            _id: replyTo,
            chatRoomId: roomId,
          });
          if (!parent)
            return emitError(
              socket,
              EVENTS.SEND_MESSAGE,
              "Reply target message not found",
            );
        }

        const message = await messageModel.create({
          chatRoomId: roomId,
          senderId: userId,
          content: content.trim(),
          messageType,
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

        // ✅ NEW: Add delivery status to the message
        const room = await chatRoomModel
          .findById(roomId)
          .select("members")
          .lean();
        const memberCount = room?.members?.length || 1;
        populated.deliveryStatus = "sent";

        socket.emit(EVENTS.MESSAGE_SENT, { message: populated });

        socket.to(`room:${roomId}`).emit(EVENTS.RECEIVE_MESSAGE, {
          message: populated,
          roomId,
        });
      } catch (err) {
        emitError(socket, EVENTS.SEND_MESSAGE, err.message);
      }
    });

    /* ----------------------------------------------------------
       TYPING / STOP_TYPING
    ---------------------------------------------------------- */
    socket.on(EVENTS.TYPING, ({ roomId }) => {
      if (!roomId) return;
      socket.to(`room:${roomId}`).emit(EVENTS.USER_TYPING, {
        roomId,
        userId,
        username: user.username,
      });
    });

    socket.on(EVENTS.STOP_TYPING, ({ roomId }) => {
      if (!roomId) return;
      socket.to(`room:${roomId}`).emit(EVENTS.USER_STOPPED_TYPING, {
        roomId,
        userId,
      });
    });

    /* ----------------------------------------------------------
       MESSAGE_SEEN
       ✅ IMPROVED: Now broadcasts delivery status update
    ---------------------------------------------------------- */
    socket.on(EVENTS.MESSAGE_SEEN, async ({ roomId, messageId }) => {
      try {
        if (!roomId || !messageId) return;

        const isMember = await isRoomMember(roomId, userId);
        if (!isMember) return;

        const pivotMsg = await messageModel
          .findOne({ _id: messageId, chatRoomId: roomId })
          .select("createdAt senderId");

        if (!pivotMsg) return;

        await messageModel.updateMany(
          {
            chatRoomId: roomId,
            createdAt: { $lte: pivotMsg.createdAt },
            "seenBy.userId": { $ne: userId },
            senderId: { $ne: userId },
          },
          { $addToSet: { seenBy: { userId, seenAt: new Date() } } },
        );

        // ✅ NEW Feature 7: Broadcast seen status for checkmark updates
        socket.to(`room:${roomId}`).emit(EVENTS.MESSAGES_SEEN, {
          roomId,
          messageId,
          seenBy: { userId, username: user.username, seenAt: new Date() },
        });

        // ✅ NEW Feature 7: Also emit delivery status update
        namespace.to(`room:${roomId}`).emit(EVENTS.MESSAGE_DELIVERY_STATUS, {
          roomId,
          messageId,
          status: "seen",
          userId,
          username: user.username,
        });
      } catch (err) {
        emitError(socket, EVENTS.MESSAGE_SEEN, err.message);
      }
    });

    /* ----------------------------------------------------------
       ADD_REACTION
    ---------------------------------------------------------- */
    socket.on(EVENTS.ADD_REACTION, async ({ roomId, messageId, reaction }) => {
      try {
        if (!roomId || !messageId || !reaction) return;
        if (!validReactions.includes(reaction))
          return emitError(
            socket,
            EVENTS.ADD_REACTION,
            `Invalid reaction. Allowed: ${validReactions.join(", ")}`,
          );

        const isMember = await isRoomMember(roomId, userId);
        if (!isMember)
          return emitError(socket, EVENTS.ADD_REACTION, "Access denied", 403);

        const message = await messageModel.findOne({
          _id: messageId,
          chatRoomId: roomId,
          deletedForEveryone: false,
        });
        if (!message)
          return emitError(socket, EVENTS.ADD_REACTION, "Message not found");

        const existing = await reactionModel.findOne({ messageId, userId });
        let reactionDoc;

        if (existing) {
          existing.reaction = reaction;
          await existing.save();
          reactionDoc = existing;
        } else {
          reactionDoc = await reactionModel.create({
            messageId,
            chatRoomId: roomId,
            userId,
            reaction,
          });
          await messageModel.updateOne(
            { _id: messageId },
            { $addToSet: { reactions: reactionDoc._id } },
          );
        }

        const summary = await reactionModel.aggregate([
          { $match: { messageId: message._id } },
          { $group: { _id: "$reaction", count: { $sum: 1 } } },
          { $project: { reaction: "$_id", count: 1, _id: 0 } },
        ]);

        namespace.to(`room:${roomId}`).emit(EVENTS.REACTION_ADDED, {
          roomId,
          messageId,
          reaction,
          userId,
          username: user.username,
          summary,
        });
      } catch (err) {
        emitError(socket, EVENTS.ADD_REACTION, err.message);
      }
    });

    /* ----------------------------------------------------------
       REMOVE_REACTION
    ---------------------------------------------------------- */
    socket.on(EVENTS.REMOVE_REACTION, async ({ roomId, messageId }) => {
      try {
        if (!roomId || !messageId) return;
        const isMember = await isRoomMember(roomId, userId);
        if (!isMember) return;

        const reactionDoc = await reactionModel.findOneAndDelete({
          messageId,
          userId,
        });
        if (!reactionDoc) return;

        await messageModel.updateOne(
          { _id: messageId },
          { $pull: { reactions: reactionDoc._id } },
        );

        const summary = await reactionModel.aggregate([
          { $match: { messageId: reactionDoc.messageId } },
          { $group: { _id: "$reaction", count: { $sum: 1 } } },
          { $project: { reaction: "$_id", count: 1, _id: 0 } },
        ]);

        namespace.to(`room:${roomId}`).emit(EVENTS.REACTION_REMOVED, {
          roomId,
          messageId,
          userId,
          summary,
        });
      } catch (err) {
        emitError(socket, EVENTS.REMOVE_REACTION, err.message);
      }
    });

    /* ----------------------------------------------------------
       EDIT_MESSAGE
    ---------------------------------------------------------- */
    socket.on(EVENTS.EDIT_MESSAGE, async ({ roomId, messageId, content }) => {
      try {
        if (!roomId || !messageId || !content?.trim())
          return emitError(
            socket,
            EVENTS.EDIT_MESSAGE,
            "roomId, messageId and content are all required",
          );

        const isMember = await isRoomMember(roomId, userId);
        if (!isMember)
          return emitError(socket, EVENTS.EDIT_MESSAGE, "Access denied", 403);

        const message = await messageModel.findOne({
          _id: messageId,
          chatRoomId: roomId,
          deletedForEveryone: false,
        });

        if (!message)
          return emitError(socket, EVENTS.EDIT_MESSAGE, "Message not found");
        if (message.senderId.toString() !== userId)
          return emitError(
            socket,
            EVENTS.EDIT_MESSAGE,
            "You can only edit your own messages",
            403,
          );

        const age = Date.now() - new Date(message.createdAt).getTime();
        if (age > EDIT_WINDOW_MS)
          return emitError(
            socket,
            EVENTS.EDIT_MESSAGE,
            "Edit window has expired (1 hour limit)",
            403,
          );

        message.content = content.trim();
        message.edited = true;
        message.editedAt = new Date();
        await message.save();

        namespace.to(`room:${roomId}`).emit(EVENTS.MESSAGE_EDITED, {
          roomId,
          messageId,
          content: message.content,
          editedAt: message.editedAt,
          editedBy: userId,
        });
      } catch (err) {
        emitError(socket, EVENTS.EDIT_MESSAGE, err.message);
      }
    });

    /* ----------------------------------------------------------
       DELETE_MESSAGE
    ---------------------------------------------------------- */
    socket.on(
      EVENTS.DELETE_MESSAGE,
      async ({ roomId, messageId, deleteType = "me" }) => {
        try {
          if (!roomId || !messageId)
            return emitError(
              socket,
              EVENTS.DELETE_MESSAGE,
              "roomId and messageId are required",
            );

          const isMember = await isRoomMember(roomId, userId);
          if (!isMember)
            return emitError(
              socket,
              EVENTS.DELETE_MESSAGE,
              "Access denied",
              403,
            );

          const message = await messageModel.findOne({
            _id: messageId,
            chatRoomId: roomId,
            deletedForEveryone: false,
          });

          if (!message)
            return emitError(
              socket,
              EVENTS.DELETE_MESSAGE,
              "Message not found",
            );

          const age = Date.now() - new Date(message.createdAt).getTime();

          if (deleteType === "everyone") {
            if (message.senderId.toString() !== userId)
              return emitError(
                socket,
                EVENTS.DELETE_MESSAGE,
                "You can only delete your own messages for everyone",
                403,
              );
            if (age > DELETE_WINDOW_MS)
              return emitError(
                socket,
                EVENTS.DELETE_MESSAGE,
                "Delete-for-everyone window has expired (1 hour limit)",
                403,
              );

            message.deletedForEveryone = true;
            message.deleted = true;
            message.content = "";
            message.attachments = [];
            await message.save();

            namespace.to(`room:${roomId}`).emit(EVENTS.MESSAGE_DELETED, {
              roomId,
              messageId,
              deleteType: "everyone",
              deletedBy: userId,
            });
          } else {
            await messageModel.updateOne(
              { _id: messageId },
              { $addToSet: { deletedFor: userId } },
            );
            socket.emit(EVENTS.MESSAGE_DELETED, {
              roomId,
              messageId,
              deleteType: "me",
            });
          }
        } catch (err) {
          emitError(socket, EVENTS.DELETE_MESSAGE, err.message);
        }
      },
    );

    /* ----------------------------------------------------------
       GET_ONLINE_USERS
    ---------------------------------------------------------- */
    socket.on(EVENTS.GET_ONLINE_USERS, async ({ roomId }) => {
      try {
        if (!roomId) return;
        const isMember = await isRoomMember(roomId, userId);
        if (!isMember) return;

        const room = await chatRoomModel
          .findOne({ _id: roomId })
          .select("members")
          .lean();
        if (!room) return;

        const onlineUserIds = room.members
          .map((m) => m.toString())
          .filter((id) => isUserOnline(id));

        socket.emit(EVENTS.ONLINE_USERS, { roomId, onlineUserIds });
      } catch (err) {
        emitError(socket, EVENTS.GET_ONLINE_USERS, err.message);
      }
    });

    /* ----------------------------------------------------------
       DISCONNECT
    ---------------------------------------------------------- */
    socket.on(EVENTS.DISCONNECT, (reason) => {
      console.log(
        `[Chat Socket] Disconnected: ${user.username} — reason: ${reason}`,
      );
      markUserOffline(userId, socket.id);

      if (!isUserOnline(userId)) {
        socket.broadcast.emit(EVENTS.USER_OFFLINE, {
          userId,
          username: user.username,
          lastSeen: new Date(),
        });
      }
    });
  });

  // ✅ NEW: Export broadcastRoomCreated so chat.service.js can use it
  namespace.broadcastRoomCreated = (room) =>
    broadcastRoomCreated(namespace, room);
};
