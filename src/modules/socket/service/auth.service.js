import { socketConnection } from "../../../DB/model/user.model.js";
import { authentication } from "../../../middleware/socket/auth.middleware.js";

export const registerSocket = async (socket) => {
  const { data, valid } = await authentication({ socket });
  if (!valid) {
    return socket.emit("socket_Error", data);
  }
  socketConnection.set(data?.user?._id?.toString(), socket.id);

  return "done";
};
export const logoutSocketId = async (socket) => {
  return socket.on("disconnect", async () => {
    const { data, valid } = await authentication({ socket });

    if (!valid) {
      return socket.emit("socket_Error", data);
    }
    socketConnection.delete(data?.user?._id?.toString());

    return "done";
  });
};
