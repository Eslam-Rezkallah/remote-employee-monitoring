import userModel, { roleTypes } from "../../DB/Model/user.model.js";
import { asyncHandler } from "../../utils/response/error.response.js";
import {
  decodedToken,
  tokenTypes,
  verifyToken,
} from "../../utils/security/token.security.js";
import * as dbService from "../../DB/db.service.js";
export const authentication = async ({
  socket = {},
  tokenType = tokenTypes.access,
  accessRoles = [],
  next = {},
  checkAuthorization = false,
} = {}) => {
  const [bearer, token] =
    socket?.handshake?.auth?.authorization?.split(" ") || [];

  if (!token || !bearer) {
    return {
      data: { message: "Authorization header is missing", status: 401 },
    };
  }

  let access_signature = "";
  let refresh_signature = "";

  switch (bearer) {
    case "Bearer":
      access_signature = process.env.USER_ACCESS_TOKEN;
      refresh_signature = process.env.USER_REFRESH_TOKEN;
      break;
    case "System":
      access_signature = process.env.ADMIN_ACCESS_TOKEN;
      refresh_signature = process.env.ADMIN_REFRESH_TOKEN;
      break;
    default:
      return { data: { message: "Invalid token type", status: 401 } };
  }

  const decoded = verifyToken({
    token,
    signature:
      tokenType == tokenTypes.access ? access_signature : refresh_signature,
  });

  if (!decoded?.id) {
    return { data: { message: "Invalid token payload", status: 401 } };
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: decoded.id, isDeleted: false },
  });

  if (!user) {
    return { data: { message: "User not found", status: 401 } };
  }

  if (user?.changeCredentialsTime?.getTime() >= decoded.iat * 1000) {
    return next(
      new Error("Credentials changed. Please log in again.", { cause: 401 })
    );
  }
  if (checkAuthorization && !accessRoles.includes(user.role)) {
    return {
      data: { message: "Unauthorized role for this token type", status: 403 },
    };
  }

  return {
    data: { message: "Authentication successful", status: 200, user },
    valid: true,
  };
};
