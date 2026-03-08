import { authentication } from "../../../middleware/socket/auth.middleware.js";

export const registerSocket = async (socket, onlineUsers) => {
  const { data, valid } = await authentication({ socket });
  if (!valid) {
    return socket.emit("socket_Error", data);
  }
  onlineUsers.set(data?.user?._id?.toString(), socket.id);
  socket.emit("onlineUsers", Array.from(onlineUsers.keys()));

  return "done";
};

export const logoutSocketId = async (socket, onlineUsers) => {
  return socket.on("disconnect", async () => {
    const { data, valid } = await authentication({ socket });
    if (!valid) {
      return socket.emit("socket_Error", data);
    }
    onlineUsers.delete(data?.user?._id?.toString());
    socket.broadcast.emit("userOffline", data?.user?._id?.toString());

    return "done";
  });
};
