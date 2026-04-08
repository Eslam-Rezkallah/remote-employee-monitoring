import { Server } from "socket.io";
import { logoutSocketId, registerSocket } from "./service/auth.service.js";
import { registerChatSocket } from "./service/chat.socket.js";

let io = undefined;
// ✅ NEW: Export chat namespace so other modules can broadcast room_created
let chatNs = undefined;

export const runIo = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    // ✅ NEW: Max buffer size for file uploads
    maxHttpBufferSize: 10e6, // 10MB
  });

  // ── Chat namespace ────────────────────────────────────────────
  chatNs = io.of("/chat");
  registerChatSocket(chatNs);

  // ── Default namespace ─────────────────────────────────────────
  io.on("connection", async (socket) => {
    await registerSocket(socket);
    await logoutSocketId(socket);
  });
};

export const getIo = () => {
  return io;
};

// ✅ NEW: Get chat namespace for broadcasting room creation events
export const getChatNamespace = () => {
  return chatNs;
};
