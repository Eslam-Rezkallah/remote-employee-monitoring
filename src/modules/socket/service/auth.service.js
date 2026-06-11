import { authentication } from "../../../middleware/socket/auth.middleware.js";
import {
  markOnline,
  markOffline,
} from "../../../utils/presence/presence.service.js";
import { childLogger } from "../../../utils/logger/logger.js";

const log = childLogger("default-socket");

export const registerSocket = async (socket) => {
  const { data, valid } = await authentication({ socket });
  if (!valid) {
    return socket.emit("socket_Error", data);
  }

  const userId = data?.user?._id?.toString();
  socket.userId = userId;
  await markOnline(userId, socket.id);
  socket.join(`user_${userId}`);

  return "done";
};

export const logoutSocketId = async (socket) => {
  socket.on("disconnect", async () => {
    const userId = socket.userId;
    if (!userId) return;
    await markOffline(userId, socket.id);
    log.debug({ userId, socketId: socket.id }, "user socket removed");
  });
};
