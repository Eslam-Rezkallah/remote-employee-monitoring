import { Server } from "socket.io";
import { registerSocket, handleDisconnect } from "./service/auth.service.js";
import {
  joinUserRooms,
  createPrivateChat,
  createGroupChat,
  createProjectChat,
  getUserChats,
} from "./service/chatRoom.service.js";
import {
  sendMessage,
  getMessages,
  editMessage,
  deleteMessage,
  markAsSeen,
  typingIndicator,
  reactToMessage,
  pinMessage,
  searchMessages,
  threadReply,
  getPinnedMessages,
} from "./service/message.service.js";

let io = undefined;

export const runIo = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    // Ping settings to detect disconnects faster
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  io.on("connection", async (socket) => {
    // ── Auth & Registration ──────────────────
    await registerSocket(io, socket);

    // If not authenticated, disconnect
    if (!socket.userId) {
      socket.disconnect(true);
      return;
    }

    // Join all user's existing rooms
    await joinUserRooms(socket);

    // ── Chat Room Events ─────────────────────
    createPrivateChat(io, socket);
    createGroupChat(io, socket);
    createProjectChat(io, socket);
    getUserChats(io, socket);

    // ── Message Events ───────────────────────
    sendMessage(io, socket);
    getMessages(io, socket);
    editMessage(io, socket);
    deleteMessage(io, socket);
    markAsSeen(io, socket);
    typingIndicator(io, socket);
    reactToMessage(io, socket);
    pinMessage(io, socket);
    searchMessages(io, socket);
    threadReply(io, socket);
    getPinnedMessages(io, socket);

    // ── Disconnect ───────────────────────────
    handleDisconnect(io, socket);
  });

  console.log("🚀 Socket.IO server running");
};

export const getIo = () => io;
