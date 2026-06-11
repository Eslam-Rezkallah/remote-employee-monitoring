/**
 * modules/socket/service/chat.socket.js
 *
 * ── Phase 2 ─────────────────────────────────────────────────
 * Presence tracking moved to utils/presence/presence.service.js
 * (Redis-backed with in-memory fallback). All console.* calls
 * replaced with structured Pino logger.
 *
 * ── Existing behavior preserved ─────────────────────────────
 * All message operations delegate to shared.message.service.js
 * so logic is never duplicated between REST and Socket paths.
 */

import mongoose from "mongoose";
import chatRoomModel from "../../../DB/Model/chatroom.model.js";
import messageModel from "../../../DB/Model/message.model.js";
import { authentication } from "../../../middleware/socket/auth.middleware.js";
import { childLogger } from "../../../utils/logger/logger.js";

// ── Presence service (replaces socketConnection Map) ──────────
import {
  markOnline,
  markOffline,
  whichAreOnline,
} from "../../../utils/presence/presence.service.js";

// ── Shared message service ────────────────────────────────────
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

const log = childLogger("chat-socket");

// ─────────────────────────────────────────────────────────────
// EVENT CONSTANTS
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
// Called by REST chat.service.js after a room is created so
// every member's connected sockets get an immediate sidebar update.
// ─────────────────────────────────────────────────────────────

function broadcastRoomCreated(namespace, room) {
  if (!room || !room.members) return;
  for (const memberId of room.members) {
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
  }
}

// ─────────────────────────────────────────────────────────────
// registerChatSocket
// ─────────────────────────────────────────────────────────────

export const registerChatSocket = (namespace) => {
  // ── Auth middleware ────────────────────────────────────────
  namespace.use(async (socket, next) => {
    const { data, valid } = await authentication({ socket });
    if (!valid) {
      log.warn(
        { reason: data?.message, status: data?.status },
        "socket auth rejected",
      );
      return next(new Error(data?.message || "Unauthorized"));
    }
    socket.user = data.user;
    return next();
  });

  namespace.on(EVENTS.CONNECT, async (socket) => {
    const user = socket.user;
    const userId = user._id.toString();

    log.info(
      { userId, username: user.username, socketId: socket.id },
      "socket connected",
    );

    // ── Mark online (Redis-backed) ───────────────────────────
    try {
      await markOnline(userId, socket.id);
    } catch (err) {
      log.error({ err, userId }, "markOnline failed");
    }

    // Join personal room for direct emits (notifications, etc.)
    socket.join(`user_${userId}`);

    // ── Auto-join all rooms this user is a member of ─────────
    try {
      const rooms = await chatRoomModel
        .find({ members: userId, isDeleted: false })
        .select("_id")
        .lean();
      for (const r of rooms) socket.join(`room:${r._id}`);

      socket.broadcast.emit(EVENTS.USER_ONLINE, {
        userId,
        username: user.username,
        image: user.image,
      });
    } catch (err) {
      log.error({ err, userId }, "auto-join rooms failed");
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

        // Mark unseen messages as delivered
        const deliverResult = await messageModel.updateMany(
          {
            chatRoomId: roomId,
            "deliveredTo.userId": { $ne: userId },
            senderId: { $ne: userId },
          },
          {
            $addToSet: {
              deliveredTo: { userId, deliveredAt: new Date() },
            },
          },
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
        log.error({ err, userId, roomId }, "JOIN_ROOM error");
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
        log.error({ err, userId }, "SEND_MESSAGE error");
        emitError(socket, EVENTS.SEND_MESSAGE, err.message);
      }
    });

    // ── FORWARD_MESSAGE ──────────────────────────────────────
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
          log.error(
            { err, userId, sourceMessageId, targetRoomId },
            "FORWARD_MESSAGE error",
          );
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

        // Only broadcast read receipts if user has them enabled
        if (modifiedCount > 0 && broadcastSeen) {
          socket.to(`room:${roomId}`).emit(EVENTS.MESSAGES_SEEN, {
            roomId,
            messageId,
            seenBy: {
              userId,
              username: user.username,
              seenAt: new Date(),
            },
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
        log.error({ err, userId, roomId, messageId }, "MESSAGE_SEEN error");
        emitError(socket, EVENTS.MESSAGE_SEEN, err.message);
      }
    });

    // ── ADD_REACTION ─────────────────────────────────────────
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
        log.error(
          { err, userId, roomId, messageId, reaction },
          "ADD_REACTION error",
        );
        emitError(socket, EVENTS.ADD_REACTION, err.message);
      }
    });

    // ── REMOVE_REACTION ──────────────────────────────────────
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
        log.error({ err, userId, roomId, messageId }, "REMOVE_REACTION error");
        emitError(socket, EVENTS.REMOVE_REACTION, err.message);
      }
    });

    // ── EDIT_MESSAGE ─────────────────────────────────────────
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
        log.error({ err, userId, roomId, messageId }, "EDIT_MESSAGE error");
        emitError(socket, EVENTS.EDIT_MESSAGE, err.message);
      }
    });

    // ── DELETE_MESSAGE ───────────────────────────────────────
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
          log.error(
            { err, userId, roomId, messageId, deleteType },
            "DELETE_MESSAGE error",
          );
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

        const memberIds = room.members.map((m) => m.toString());
        const onlineUserIds = await whichAreOnline(memberIds);

        socket.emit(EVENTS.ONLINE_USERS, { roomId, onlineUserIds });
      } catch (err) {
        log.error({ err, userId, roomId }, "GET_ONLINE_USERS error");
        emitError(socket, EVENTS.GET_ONLINE_USERS, err.message);
      }
    });

    // ── DISCONNECT ───────────────────────────────────────────
    socket.on(EVENTS.DISCONNECT, async (reason) => {
      log.info(
        { userId, username: user.username, socketId: socket.id, reason },
        "socket disconnected",
      );

      try {
        // markOffline returns true if this was the user's LAST socket
        // across all instances (Redis-backed) — only then we broadcast offline.
        const fullyOffline = await markOffline(userId, socket.id);

        if (fullyOffline) {
          socket.broadcast.emit(EVENTS.USER_OFFLINE, {
            userId,
            username: user.username,
            lastSeen: new Date(),
          });
        }
      } catch (err) {
        log.error({ err, userId }, "disconnect cleanup failed");
      }
    });
  });

  // Expose broadcastRoomCreated so REST chat.service.js can call it
  // through getChatNamespace().broadcastRoomCreated(room)
  namespace.broadcastRoomCreated = (room) =>
    broadcastRoomCreated(namespace, room);
};
