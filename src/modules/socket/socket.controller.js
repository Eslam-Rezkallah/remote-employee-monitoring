import { Server } from "socket.io";
import { logoutSocketId, registerSocket } from "./service/auth.service.js";
import { registerChatSocket } from "./service/chat.socket.js";
import { registerCallSocket } from "./service/call.socket.js";

let io = undefined;
let chatNs = undefined;
let callNs = undefined;

export const runIo = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 10e6, // 10MB
  });

  // ── Chat namespace (/chat) ────────────────────────────────
  chatNs = io.of("/chat");
  registerChatSocket(chatNs);

  // ── Call namespace (/call) ────────────────────────────────
  // Separate namespace keeps call signaling traffic isolated
  // from regular chat messages for better performance.
  callNs = io.of("/call");
  registerCallSocket(callNs);

  // ── Default namespace ─────────────────────────────────────
  io.on("connection", async (socket) => {
    await registerSocket(socket);
    await logoutSocketId(socket);
  });
};

export const getIo = () => io;
export const getChatNamespace = () => chatNs;
export const getCallNamespace = () => callNs;
