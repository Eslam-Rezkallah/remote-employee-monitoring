import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import {
  generateToken,
  verifyToken,
  tokenTypes,
} from "../../../utils/security/token.security.js";
import * as dbService from "../../../DB/db.service.js";
import sessionModel from "../../../DB/Model/session.model.js";
import userModel, { roleTypes } from "../../../DB/Model/user.model.js";

// ─── Helper: pick access & refresh signatures based on role ─────────────────
const getSignatures = (role) => {
  const isAdmin = role === roleTypes.Admin;
  return {
    accessSignature: isAdmin
      ? process.env.ADMIN_ACCESS_TOKEN
      : process.env.USER_ACCESS_TOKEN,
    refreshSignature: isAdmin
      ? process.env.ADMIN_REFRESH_TOKEN
      : process.env.USER_REFRESH_TOKEN,
  };
};

// ─── Helper: create a brand-new session document ────────────────────────────
export const createSession = async ({ user, req }) => {
  const { accessSignature, refreshSignature } = getSignatures(user.role);

  const accessToken = generateToken({
    payload: { id: user._id, sessionType: "access" },
    signature: accessSignature,
    expiresIn: parseInt(process.env.TOKEN_EXPIRATION), // 15 min
  });

  const refreshToken = generateToken({
    payload: { id: user._id, sessionType: "refresh" },
    signature: refreshSignature,
    expiresIn: parseInt(process.env.REFRESH_TOKEN_EXPIRATION), // 7 days
  });

  // Expire date for the session document (matches refresh token)
  const expiresAt = new Date(
    Date.now() + parseInt(process.env.REFRESH_TOKEN_EXPIRATION) * 1000
  );

  await dbService.create({
    model: sessionModel,
    data: {
      userId: user._id,
      refreshToken,
      userAgent: req.headers["user-agent"] || "Unknown",
      ipAddress: req.ip || req.connection?.remoteAddress || "Unknown",
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
};

// ─── POST /auth/refresh-token ─────────────────────────────────────────────────
export const refreshToken = asyncHandler(async (req, res, next) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    return next(new Error("Refresh token is required", { cause: 400 }));
  }

  // Try both user and admin refresh signatures
  let decoded = null;
  let matchedSignature = null;

  for (const sig of [
    process.env.USER_REFRESH_TOKEN,
    process.env.ADMIN_REFRESH_TOKEN,
  ]) {
    try {
      decoded = verifyToken({ token, signature: sig });
      matchedSignature = sig;
      break;
    } catch (_) {
      // try next signature
    }
  }

  if (!decoded?.id) {
    return next(new Error("Invalid or expired refresh token", { cause: 401 }));
  }

  // Find matching active session
  const session = await dbService.findOne({
    model: sessionModel,
    filter: {
      refreshToken: token,
      userId: decoded.id,
      isRevoked: false,
    },
  });

  if (!session) {
    return next(
      new Error("Session not found or already revoked", { cause: 401 })
    );
  }

  if (session.expiresAt < new Date()) {
    return next(new Error("Session expired. Please log in again.", { cause: 401 }));
  }

  // Load user
  const user = await dbService.findOne({
    model: userModel,
    filter: { _id: decoded.id, isDeleted: false },
  });

  if (!user) {
    return next(new Error("User not found", { cause: 401 }));
  }

  const { accessSignature } = getSignatures(user.role);

  // Issue a new access token only
  const newAccessToken = generateToken({
    payload: { id: user._id, sessionType: "access" },
    signature: accessSignature,
    expiresIn: parseInt(process.env.TOKEN_EXPIRATION),
  });

  // Update lastUsedAt on the session
  await dbService.findOneAndUpdate({
    model: sessionModel,
    filter: { _id: session._id },
    data: { lastUsedAt: new Date() },
    options: { new: true },
  });

  return successResponse(
    { res, data: { accessToken: newAccessToken } },
    200
  );
});

// ─── POST /auth/logout ────────────────────────────────────────────────────────
export const logout = asyncHandler(async (req, res, next) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    return next(new Error("Refresh token is required", { cause: 400 }));
  }

  const session = await dbService.findOneAndUpdate({
    model: sessionModel,
    filter: {
      refreshToken: token,
      userId: req.user._id,
      isRevoked: false,
    },
    data: { isRevoked: true },
    options: { new: true },
  });

  if (!session) {
    return next(new Error("Session not found or already logged out", { cause: 404 }));
  }

  return successResponse({ res, data: { message: "Logged out successfully" } }, 200);
});

// ─── POST /auth/logout-all ────────────────────────────────────────────────────
export const logoutAll = asyncHandler(async (req, res, next) => {
  await dbService.updateMany({
    model: sessionModel,
    filter: { userId: req.user._id, isRevoked: false },
    data: { isRevoked: true },
  });

  return successResponse(
    { res, data: { message: "Logged out from all devices successfully" } },
    200
  );
});

// ─── GET /auth/sessions ───────────────────────────────────────────────────────
export const getSessions = asyncHandler(async (req, res, next) => {
  const sessions = await dbService.find({
    model: sessionModel,
    filter: { userId: req.user._id, isRevoked: false },
    select: "-refreshToken", // never expose the raw refresh token
  });

  return successResponse({ res, data: { sessions } }, 200);
});

// ─── DELETE /auth/sessions/:sessionId ────────────────────────────────────────
export const revokeSession = asyncHandler(async (req, res, next) => {
  const { sessionId } = req.params;

  const session = await dbService.findOneAndUpdate({
    model: sessionModel,
    filter: {
      _id: sessionId,
      userId: req.user._id, // users can only revoke their own sessions
      isRevoked: false,
    },
    data: { isRevoked: true },
    options: { new: true },
  });

  if (!session) {
    return next(
      new Error("Session not found or already revoked", { cause: 404 })
    );
  }

  return successResponse(
    { res, data: { message: "Session revoked successfully" } },
    200
  );
});
