import jwt from "jsonwebtoken";
import userModel, { roleTypes } from "../../DB/Model/user.model.js";
import sessionModel from "../../DB/Model/session.model.js";
import * as dbService from "../../DB/db.service.js";

export const tokenTypes = {
  access: "access",
  refresh: "refresh",
};
export const decodedToken = async ({
  authorization = "",
  tokenType = tokenTypes.access,
  next = {},
} = {}) => {
  const [bearer, token] = authorization?.split(" ") || [];

  if (!token) {
    return next(new Error("Authorization header is missing", 401));
  }

  let access_signature = "";
  let refresh_signature = "";
  let allowedRoles = [];

  switch (bearer) {
    case "Bearer":
      access_signature = process.env.USER_ACCESS_TOKEN;
      refresh_signature = process.env.USER_REFRESH_TOKEN;
      allowedRoles = [roleTypes.Admin, roleTypes.Manager, roleTypes.Member];
      break;
    case "System":
      access_signature = process.env.ADMIN_ACCESS_TOKEN;
      refresh_signature = process.env.ADMIN_REFRESH_TOKEN;
      allowedRoles = [roleTypes.admin, roleTypes.superAdmin];
      break;
    default:
      return next(new Error("Invalid token type", 401));
  }

  const decoded = verifyToken({
    token,
    signature:
      tokenType == tokenTypes.access ? access_signature : refresh_signature,
  });

  if (!decoded?.id) {
    return next(new Error("Invalid token payload", 401));
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: decoded.id, isDeleted: false },
  });

  if (!user) {
    return next(new Error("User not found", 401));
  }

  if (!allowedRoles.includes(user.role)) {
    return next(new Error("Unauthorized role for this token type", 403));
  }

  if (user?.changeCredentialsTime?.getTime() >= decoded.iat * 1000) {
    return next(
      new Error("Credentials changed. Please log in again.", { cause: 401 })
    );
  }

  // ── Session validation ──────────────────────────────────────────────────────
  // We embed sessionType in the payload when generating tokens.
  // Only access tokens (sessionType === "access") are used for protected routes.
  if (decoded.sessionType && decoded.sessionType !== "access") {
    return next(new Error("Invalid token type for this request", { cause: 401 }));
  }

  // If the token was issued after session management was added it will have
  // a sessionType field. Validate that the user still has at least one active
  // (non-revoked, non-expired) session — prevents using tokens after logout.
  if (decoded.sessionType === "access") {
    const activeSession = await dbService.findOne({
      model: sessionModel,
      filter: {
        userId: user._id,
        isRevoked: false,
        expiresAt: { $gt: new Date() },
      },
    });

    if (!activeSession) {
      return next(
        new Error("Session expired or logged out. Please log in again.", {
          cause: 401,
        })
      );
    }
  }

  return user;
};

export const generateToken = ({
  payload = {},
  signature = process.env.USER_ACCESS_TOKEN,
  expiresIn = process.env.TOKEN_EXPIRATION,
} = {}) => {
  const token = jwt.sign(payload, signature, {
    expiresIn: parseInt(expiresIn),
  });
  return token;
};
export const verifyToken = ({
  token,
  signature = process.env.USER_ACCESS_TOKEN,
} = {}) => {
  const decoded = jwt.verify(token, signature);
  return decoded;
};
