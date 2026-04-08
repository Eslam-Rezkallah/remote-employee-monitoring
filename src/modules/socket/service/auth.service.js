import { socketConnection } from "../../../DB/Model/user.model.js";
import { authentication } from "../../../middleware/socket/auth.middleware.js";

export const registerSocket = async (socket) => {
  const { data, valid } = await authentication({ socket });
  if (!valid) {
    return socket.emit("socket_Error", data);
  }
  const userId = data?.user?._id?.toString();
  socketConnection.set(userId, socket.id);
  // So notification.event.js can emit to io.to(`user_${userId}`)
  socket.join(`user_${userId}`);
  return "done";
};
export const logoutSocketId = async (socket) => {
  return socket.on("disconnect", async () => {
    const { data, valid } = await authentication({ socket });
    console.log({ data, valid });
    if (!valid) {
      return socket.emit("socket_Error", data);
    }
    socketConnection.delete(data?.user?._id?.toString());
    console.log(socketConnection);

    return "done";
  });
};
