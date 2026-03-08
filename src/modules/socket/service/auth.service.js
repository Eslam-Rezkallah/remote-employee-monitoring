import { authentication } from "../../../middleware/socket/auth.middleware.js";
import {
  addOnlineUser,
  removeOnlineUser,
  getOnlineUserIds,
  getUserSocketIds,
} from "../../message/service/store/onlineUsers.store.js";

/**
 * Register socket connection - adds user to online store and joins their rooms
 */
export const registerSocket = async (io, socket) => {
  const { data, valid } = await authentication({ socket });

  if (!valid) {
    return socket.emit("socket_error", data);
  }

  const userId = data.user._id.toString();
  addOnlineUser(userId, socket.id);

  // Store user info on socket for later use
  socket.userId = userId;
  socket.user = data.user;

  // Join personal room (for direct notifications)
  socket.join(`user:${userId}`);

  // Notify others that this user is online
  socket.broadcast.emit("user:online", { userId });

  // Send current online users to the newly connected user
  socket.emit("users:online", { onlineUsers: getOnlineUserIds() });

  console.log(`✅ User ${userId} connected with socket ${socket.id}`);
};

/**
 * Handle socket disconnect
 */
export const handleDisconnect = (io, socket) => {
  socket.on("disconnect", () => {
    if (!socket.userId) return;

    removeOnlineUser(socket.userId, socket.id);

    // Check if user still has other active connections
    const remainingSockets = getUserSocketIds(socket.userId);
    if (remainingSockets.length === 0) {
      // User fully offline - notify others
      socket.broadcast.emit("user:offline", {
        userId: socket.userId,
        lastSeen: new Date(),
      });
    }

    console.log(`❌ User ${socket.userId} disconnected socket ${socket.id}`);
  });
};
