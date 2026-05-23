import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import ms from "ms";
import userModel, { roleTypes } from "../../../DB/Model/user.model.js";
import refreshTokenModel from "../../../DB/Model/refreshToken.model.js";
import * as dbService from "../../../DB/db.service.js";
import { config } from "../../../config/index.js";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
} from "../../../utils/security/token.security.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { UnauthorizedError } from "../../../utils/errors/index.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

/**
 * POST /auth/refresh
 * Body: { refreshToken }
 *
 * Rotates the refresh token (best practice): old one revoked, new one issued.
 */
export const refreshAccessToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  // Try verify with both user and admin refresh secrets
  let decoded;
  let role = roleTypes.Member;

  try {
    decoded = verifyToken({
      token: refreshToken,
      signature: config.security.userRefreshSecret,
    });
  } catch {
    try {
      decoded = verifyToken({
        token: refreshToken,
        signature: config.security.adminRefreshSecret,
      });
      role = roleTypes.Admin;
    } catch {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }
  }

  if (!decoded?.id) {
    throw new UnauthorizedError("Invalid refresh token payload");
  }

  // Check it's stored and not revoked
  const stored = await dbService.findOne({
    model: refreshTokenModel,
    filter: {
      userId: decoded.id,
      tokenHash: hashToken(refreshToken),
      revokedAt: null,
    },
  });

  if (!stored) {
    throw new UnauthorizedError("Refresh token revoked or not found");
  }

  // Check user still exists & valid
  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: decoded.id, isDeleted: false },
  });

  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  if (user?.changeCredentialsTime?.getTime() >= decoded.iat * 1000) {
    throw new UnauthorizedError("Credentials changed. Please log in again.");
  }

  // Revoke old refresh token (rotation)
  stored.revokedAt = new Date();
  await stored.save();

  // Issue new pair
  const newAccessToken = generateAccessToken({
    payload: { id: user._id },
    role: user.role,
  });
  const newRefreshToken = generateRefreshToken({
    payload: { id: user._id },
    role: user.role,
  });

  await dbService.create({
    model: refreshTokenModel,
    data: {
      userId: user._id,
      tokenHash: hashToken(newRefreshToken),
      expiresAt: new Date(
        Date.now() + ms(config.security.refreshTokenExpiration),
      ),
      userAgent: req.headers["user-agent"] || null,
      ipAddress: req.ip || null,
    },
  });

  return successResponse({
    res,
    message: "Tokens refreshed",
    data: {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    },
  });
});
