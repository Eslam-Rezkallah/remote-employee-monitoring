import { Server } from "socket.io";
import { logoutSocketId, registerSocket } from "./service/auth.service.js";
import { sendMessage } from "./service/message.service.js";

let io = undefined;
export const runIo = (httpServer) => {
  io = new Server(httpServer, {
    cors: "*",
  });

  io.on("connection", async (socket) => {
    await registerSocket(socket);
    await sendMessage(socket);

    await logoutSocketId(socket);
  });
};
export const getIo = () => {
  return io;
};
