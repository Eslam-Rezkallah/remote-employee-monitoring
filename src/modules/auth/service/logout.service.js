import crypto from "node:crypto";
import refreshTokenModel from "../../../DB/Model/refreshToken.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

/**
 * POST /auth/logout
 * Body: { refreshToken }
 *
 * Revokes a single refresh token (this device).
 */
export const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (refreshToken) {
    await dbService.updateOne({
      model: refreshTokenModel,
      filter: {
        userId: req.user._id,
        tokenHash: hashToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  return successResponse({ res, message: "Logged out successfully" });
});

/**
 * POST /auth/logout-all
 *
 * Revokes all refresh tokens for this user (logout from all devices).
 */
export const logoutAll = asyncHandler(async (req, res) => {
  await dbService.updateMany({
    model: refreshTokenModel,
    filter: {
      userId: req.user._id,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  return successResponse({ res, message: "Logged out from all devices" });
});
