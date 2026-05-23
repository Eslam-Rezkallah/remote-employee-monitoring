import jwt from "jsonwebtoken";
import userModel, { roleTypes } from "../../DB/Model/user.model.js";
import * as dbService from "../../DB/db.service.js";
import { UnauthorizedError, ForbiddenError } from "../errors/index.js";
import { config } from "../../config/index.js";
export const tokenTypes = {
  access: "access",
  refresh: "refresh",
};
export const generateAccessToken = ({
  payload = {},
  role = roleTypes.Member,
} = {}) => {
  const signature =
    role === roleTypes.Admin
      ? config.security.adminAccessSecret
      : config.security.userAccessSecret;

  return jwt.sign(payload, signature, {
    expiresIn: config.security.accessTokenExpiration, // "15m"
  });
};

/**
 * Generate a refresh token (long-lived, ~7 days).
 */
export const generateRefreshToken = ({
  payload = {},
  role = roleTypes.Member,
} = {}) => {
  const signature =
    role === roleTypes.Admin
      ? config.security.adminRefreshSecret
      : config.security.userRefreshSecret;

  return jwt.sign(payload, signature, {
    expiresIn: config.security.refreshTokenExpiration, // "7d"
  });
};
export const decodedToken = async ({
  authorization = "",
  tokenType = tokenTypes.access,
} = {}) => {
  const [bearer, token] = authorization?.split(" ") || [];

  if (!token) {
    throw new UnauthorizedError("Authorization header is missing");
  }

  let access_signature = "";
  let refresh_signature = "";
  let allowedRoles = [];

  switch (bearer) {
    case "Bearer":
      access_signature = config.security.userAccessSecret;
      refresh_signature = config.security.userRefreshSecret;
      allowedRoles = [roleTypes.Member, roleTypes.Manager];
      break;
    case "System":
      access_signature = config.security.adminAccessSecret;
      refresh_signature = config.security.adminRefreshSecret;
      allowedRoles = [roleTypes.Admin];
      break;
    default:
      throw new UnauthorizedError("Invalid token type");
  }

  const decoded = verifyToken({
    token,
    signature:
      tokenType === tokenTypes.access ? access_signature : refresh_signature,
  });

  if (!decoded?.id) {
    throw new UnauthorizedError("Invalid token payload");
  }

  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: decoded.id, isDeleted: false },
  });

  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  if (!allowedRoles.includes(user.role)) {
    throw new ForbiddenError("Unauthorized role for this token type");
  }

  if (user?.changeCredentialsTime?.getTime() >= decoded.iat * 1000) {
    throw new UnauthorizedError("Credentials changed. Please log in again.");
  }

  return user;
};
export const generateToken = ({
  payload = {},
  signature = config.security.userAccessSecret,
  expiresIn = config.security.accessTokenExpiration,
} = {}) => {
  return jwt.sign(payload, signature, { expiresIn });
};
export const verifyToken = ({
  token,
  signature = config.security.userAccessSecret,
} = {}) => {
  return jwt.verify(token, signature);
};
