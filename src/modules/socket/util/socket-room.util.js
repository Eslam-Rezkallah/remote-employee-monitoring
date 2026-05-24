// src/modules/socket/util/socket-room.util.js
import { getChatNamespace } from "../socket.controller.js";

/**
 * Force a user's chat sockets to leave a specific room.
 * Called when a user is removed from a chatroom via REST,
 * so their open sockets stop receiving messages from that room.
 */
export async function forceUserLeaveRoom(userId, roomId) {
  try {
    const chatNs = getChatNamespace();
    if (!chatNs) return;

    // Notify client so it can update UI
    chatNs.to(`user_${userId}`).emit("forced_leave_room", { roomId });

    // Remove all of this user's sockets from the room
    const sockets = await chatNs.in(`user_${userId}`).fetchSockets();
    for (const s of sockets) {
      s.leave(`room:${roomId}`);
    }
  } catch (err) {
    // Never let socket cleanup break a REST request
    console.error("[forceUserLeaveRoom] failed:", err.message);
  }
}

/**
 * Force multiple users out of a room (e.g. when a room is deleted).
 */
export async function forceAllMembersLeaveRoom(memberIds, roomId) {
  await Promise.all(
    memberIds.map((id) =>
      forceUserLeaveRoom(id?.toString?.() || String(id), roomId),
    ),
  );
}
