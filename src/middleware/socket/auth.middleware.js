import userModel from "../../DB/Model/user.model.js";
import { decodedToken } from "../../utils/security/token.security.js";

export const authentication = async ({ socket = {} } = {}) => {
  const { authorization } = socket.handshake.auth;
  const req = { headers: { authorization } };
  const user = await decodedToken({ authorization, next: () => {} });
  if (!user) return { data: { message: "Invalid token" }, valid: false };

  return { data: { user }, valid: true };
};
