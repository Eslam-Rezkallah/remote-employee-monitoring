import { Server } from "socket.io";
import { logoutSocketId, registerSocket } from "./service/auth.service.js";
import {
  sendMessage,
  handleTyping,
  handleReaction,
} from "./service/chat.service.js";

let io = undefined;
const onlineUsers = new Map();

export const runIo = (httpServer) => {
  io = new Server(httpServer, {
    cors: "*",
  });

  io.on("connection", async (socket) => {
    await registerSocket(socket, onlineUsers);
    await sendMessage(socket, io);
    await handleTyping(socket, io);
    await handleReaction(socket, io);

    await logoutSocketId(socket, onlineUsers);
  });
};

export const getIo = () => {
  return io;
};

export const getOnlineUsers = () => {
  return Array.from(onlineUsers.keys());
};
