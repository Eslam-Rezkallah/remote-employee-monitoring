// src/modules/auth/service/logout.service.js
import crypto from "node:crypto";
import refreshTokenModel from "../../../DB/Model/refreshToken.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { recordAudit } from "../../../utils/audit/audit.logger.js";
import { auditActions } from "../../../utils/audit/audit.actions.js";

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

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

  await recordAudit({
    req,
    actorId: req.user._id,
    action: auditActions.AUTH_LOGOUT,
  });

  return successResponse({
    res,
    message: "Logged out successfully",
    data: null,
  });
});

export const logoutAll = asyncHandler(async (req, res) => {
  const { modifiedCount } = await dbService.updateMany({
    model: refreshTokenModel,
    filter: { userId: req.user._id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await recordAudit({
    req,
    actorId: req.user._id,
    action: auditActions.AUTH_LOGOUT_ALL,
    meta: { sessionsRevoked: modifiedCount },
  });

  return successResponse({
    res,
    message: "Logged out from all devices",
    data: { sessionsRevoked: modifiedCount },
  });
});
