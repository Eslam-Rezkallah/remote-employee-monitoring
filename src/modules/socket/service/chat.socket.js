/**
 * modules/socket/service/chat.socket.js
 *
 * ── REFACTORED ──────────────────────────────────────────────
 * All message operations now delegate to shared.message.service.js
 * so logic is never duplicated between REST and Socket paths.
 */

import mongoose from "mongoose";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import { validReactions } from "../../../DB/Model/reaction.model.js";
import { socketConnection } from "../../../DB/Model/user.model.js";
import { authentication } from "../../../middleware/socket/auth.middleware.js";

// ── Shared service ────────────────────────────────────────────
import {
  requireRoomMember,
  createMessage,
  editMessageById,
  deleteMessageById,
  markMessagesSeen,
  addReactionToMessage,
  removeReactionFromMessage,
  forwardMessage,
} from "../../message/service/shared.message.service.js";

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

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

  // ✅ NEW
  FORWARD_MESSAGE: "forward_message",
  MESSAGE_FORWARDED: "message_forwarded",

  USER_ONLINE: "user_online",
  USER_OFFLINE: "user_offline",
  GET_ONLINE_USERS: "get_online_users",
  ONLINE_USERS: "online_users",

  ROOM_CREATED: "room_created",
  MESSAGE_DELIVERY_STATUS: "message_delivery_status",
};

// ─────────────────────────────────────────────────────────────
// PRESENCE HELPERS
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────
// BROADCAST ROOM CREATED
// ─────────────────────────────────────────────────────────────

function broadcastRoomCreated(namespace, room) {
  if (!room || !room.members) return;
  room.members.forEach((memberId) => {
    const id = memberId.toString ? memberId.toString() : String(memberId);
    namespace.to(`user_${id}`).emit(EVENTS.ROOM_CREATED, {
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

// ─────────────────────────────────────────────────────────────
// registerChatSocket
// ─────────────────────────────────────────────────────────────

export const registerChatSocket = (namespace) => {
  // ── Auth middleware ────────────────────────────────────────
  namespace.use(async (socket, next) => {
    const { data, valid } = await authentication({ socket });
    if (!valid) {
      return next(new Error(data?.message || "Unauthorized"));
    }
    socket.user = data.user;
    return next();
  });

  namespace.on(EVENTS.CONNECT, async (socket) => {
    const user = socket.user;
    const userId = user._id.toString();

    console.log(`[Chat Socket] Connected: ${user.username} (${userId})`);

    markUserOnline(userId, socket.id);
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

    // ── JOIN_ROOM ────────────────────────────────────────────
    socket.on(EVENTS.JOIN_ROOM, async ({ roomId }) => {
      try {
        if (!roomId)
          return emitError(socket, EVENTS.JOIN_ROOM, "roomId is required");

        const isMember = await isRoomMember(roomId, userId);
        if (!isMember)
          return emitError(socket, EVENTS.JOIN_ROOM, "Access denied", 403);

        socket.join(`room:${roomId}`);

        const deliverResult = await messageModel.updateMany(
          {
            chatRoomId: roomId,
            "deliveredTo.userId": { $ne: userId },
            senderId: { $ne: userId },
          },
          { $addToSet: { deliveredTo: { userId, deliveredAt: new Date() } } },
        );

        socket.emit(EVENTS.ROOM_JOINED, { roomId });

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

    // ── LEAVE_ROOM ───────────────────────────────────────────
    socket.on(EVENTS.LEAVE_ROOM, ({ roomId }) => {
      if (!roomId)
        return emitError(socket, EVENTS.LEAVE_ROOM, "roomId is required");
      socket.leave(`room:${roomId}`);
      socket.emit(EVENTS.ROOM_LEFT, { roomId });
    });

    // ── SEND_MESSAGE ─────────────────────────────────────────
    // ✅ Now uses shared createMessage()
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

        const populated = await createMessage({
          roomId,
          userId,
          content,
          messageType,
          replyTo: replyTo || null,
        });

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

    // ── FORWARD_MESSAGE ──────────────────────────────────────
    // ✅ NEW: Forward a message to another room via socket
    socket.on(
      EVENTS.FORWARD_MESSAGE,
      async ({ sourceMessageId, targetRoomId }) => {
        try {
          if (!sourceMessageId || !targetRoomId) {
            return emitError(
              socket,
              EVENTS.FORWARD_MESSAGE,
              "sourceMessageId and targetRoomId are required",
            );
          }

          const populated = await forwardMessage({
            sourceMessageId,
            targetRoomId,
            userId,
          });

          // Notify the target room
          namespace.to(`room:${targetRoomId}`).emit(EVENTS.RECEIVE_MESSAGE, {
            message: populated,
            roomId: targetRoomId,
          });

          // Confirm to sender
          socket.emit(EVENTS.MESSAGE_FORWARDED, {
            message: populated,
            targetRoomId,
          });
        } catch (err) {
          emitError(socket, EVENTS.FORWARD_MESSAGE, err.message);
        }
      },
    );

    // ── TYPING ───────────────────────────────────────────────
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

    // ── MESSAGE_SEEN ─────────────────────────────────────────
    // ✅ Now uses shared markMessagesSeen()
  socket.on(EVENTS.MESSAGE_SEEN, async ({ roomId, messageId }) => {
    try {
      if (!roomId || !messageId) return;

      const isMember = await isRoomMember(roomId, userId);
      if (!isMember) return;

      const { modifiedCount, broadcastSeen } = await markMessagesSeen({
        roomId,
        messageId,
        userId,
      });

      // Only broadcast if user has read receipts enabled
      if (modifiedCount > 0 && broadcastSeen) {
        socket.to(`room:${roomId}`).emit(EVENTS.MESSAGES_SEEN, {
          roomId,
          messageId,
          seenBy: { userId, username: user.username, seenAt: new Date() },
        });

        namespace.to(`room:${roomId}`).emit(EVENTS.MESSAGE_DELIVERY_STATUS, {
          roomId,
          messageId,
          status: "seen",
          userId,
          username: user.username,
        });
      }
    } catch (err) {
      emitError(socket, EVENTS.MESSAGE_SEEN, err.message);
    }
  });

    // ── ADD_REACTION ─────────────────────────────────────────
    // ✅ Now uses shared addReactionToMessage()
    socket.on(EVENTS.ADD_REACTION, async ({ roomId, messageId, reaction }) => {
      try {
        if (!roomId || !messageId || !reaction) return;

        const isMember = await isRoomMember(roomId, userId);
        if (!isMember)
          return emitError(socket, EVENTS.ADD_REACTION, "Access denied", 403);

        const result = await addReactionToMessage({
          roomId,
          messageId,
          userId,
          reaction,
        });

        if (result.unchanged) return;

        namespace.to(`room:${roomId}`).emit(EVENTS.REACTION_ADDED, {
          roomId,
          messageId,
          reaction,
          userId,
          username: user.username,
          summary: result.summary,
        });
      } catch (err) {
        emitError(socket, EVENTS.ADD_REACTION, err.message);
      }
    });

    // ── REMOVE_REACTION ──────────────────────────────────────
    // ✅ Now uses shared removeReactionFromMessage()
    socket.on(EVENTS.REMOVE_REACTION, async ({ roomId, messageId }) => {
      try {
        if (!roomId || !messageId) return;
        const isMember = await isRoomMember(roomId, userId);
        if (!isMember) return;

        const { summary } = await removeReactionFromMessage({
          roomId,
          messageId,
          userId,
        });

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

    // ── EDIT_MESSAGE ─────────────────────────────────────────
    // ✅ Now uses shared editMessageById()
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

        const { editedAt } = await editMessageById({
          roomId,
          messageId,
          userId,
          content,
        });

        namespace.to(`room:${roomId}`).emit(EVENTS.MESSAGE_EDITED, {
          roomId,
          messageId,
          content: content.trim(),
          editedAt,
          editedBy: userId,
        });
      } catch (err) {
        emitError(socket, EVENTS.EDIT_MESSAGE, err.message);
      }
    });

    // ── DELETE_MESSAGE ───────────────────────────────────────
    // ✅ Now uses shared deleteMessageById()
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

          const result = await deleteMessageById({
            roomId,
            messageId,
            userId,
            deleteType,
          });

          if (result.deleteType === "everyone") {
            namespace.to(`room:${roomId}`).emit(EVENTS.MESSAGE_DELETED, {
              roomId,
              messageId,
              deleteType: "everyone",
              deletedBy: userId,
            });
          } else {
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

    // ── GET_ONLINE_USERS ─────────────────────────────────────
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

    // ── DISCONNECT ───────────────────────────────────────────
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

  // expose broadcastRoomCreated so REST chat.service.js can use it
  namespace.broadcastRoomCreated = (room) =>
    broadcastRoomCreated(namespace, room);
};
