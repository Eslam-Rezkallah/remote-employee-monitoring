// src/middleware/socket/auth.middleware.js
import userModel from "../../DB/Model/user.model.js";
import {
  tokenTypes,
  verifyToken,
} from "../../utils/security/token.security.js";
import * as dbService from "../../DB/db.service.js";
import { config } from "../../config/index.js";

export const authentication = async ({
  socket = {},
  tokenType = tokenTypes.access,
  accessRoles = [],
  checkAuthorization = false,
} = {}) => {
  const [bearer, token] =
    socket?.handshake?.auth?.authorization?.split(" ") || [];

  if (!token || !bearer) {
    return {
      data: { message: "Authorization header is missing", status: 401 },
    };
  }

  let accessSignature = "";
  let refreshSignature = "";

  switch (bearer) {
    case "Bearer":
      accessSignature = config.security.userAccessSecret;
      refreshSignature = config.security.userRefreshSecret;
      break;
    case "System":
      accessSignature = config.security.adminAccessSecret;
      refreshSignature = config.security.adminRefreshSecret;
      break;
    default:
      return { data: { message: "Invalid token type", status: 401 } };
  }

  let decoded;
  try {
    decoded = verifyToken({
      token,
      signature:
        tokenType === tokenTypes.access ? accessSignature : refreshSignature,
    });
  } catch {
    return { data: { message: "Invalid or expired token", status: 401 } };
  }

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
    return {
      data: {
        message: "Credentials changed. Please log in again.",
        status: 401,
      },
    };
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
