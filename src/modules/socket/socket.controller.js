import { Server } from "socket.io";
import { logoutSocketId, registerSocket } from "./service/auth.service.js";
import { registerChatSocket } from "./service/chat.socket.js";

let io = undefined;

export const runIo = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Chat namespace: all real-time chat events (send_message, typing, reactions, etc.) ──────
  const chatNamespace = io.of("/chat");
  registerChatSocket(chatNamespace);

  // ── Default namespace: auth, presence, logout ────
  io.on("connection", async (socket) => {
    await registerSocket(socket);
    await logoutSocketId(socket);
  });
};

export const getIo = () => {
  return io;
};
