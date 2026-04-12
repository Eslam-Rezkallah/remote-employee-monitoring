import { socketConnection } from "../../../DB/Model/user.model.js";
import { authentication } from "../../../middleware/socket/auth.middleware.js";

// ─────────────────────────────────────────────────────────────
// registerSocket
// Authenticates the socket on connection and stores userId → socketId.
// Also joins the user's personal room for notification delivery.
// ─────────────────────────────────────────────────────────────

export const registerSocket = async (socket) => {
  const { data, valid } = await authentication({ socket });

  if (!valid) {
    return socket.emit("socket_Error", data);
  }

  const userId = data?.user?._id?.toString();

  // store userId on socket so disconnect handler can use it
  // without needing to re-parse the token
  socket.userId = userId;

  socketConnection.set(userId, socket.id);

  // join personal room — used by notification.event.js and chat broadcasts
  socket.join(`user_${userId}`);

  return "done";
};

// ─────────────────────────────────────────────────────────────
// logoutSocketId
// FIX: was calling authentication() on disconnect which is
//      wasteful and unreliable (handshake data may be gone).
//      Now uses socket.userId stored during connection above.
// ─────────────────────────────────────────────────────────────

export const logoutSocketId = async (socket) => {
  socket.on("disconnect", async () => {
    const userId = socket.userId;

    // if socket was never authenticated, nothing to clean up
    if (!userId) return;

    socketConnection.delete(userId);
  });
};
