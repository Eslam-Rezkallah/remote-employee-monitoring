import mongoose from "mongoose";
import { config } from "../../config/index.js";
import { AppError } from "../errors/index.js";
import { logger } from "../logger/logger.js";
import { captureException } from "../observability/sentry.js";

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const buildErrorBody = (statusCode, message, details, err) => {
  const body = { success: false, message, data: null };
  if (details) body.details = details;
  if (config.app.isDev && statusCode >= 500 && err?.stack) {
    body.stack = err.stack;
  }
  return body;
};

export const globalErrorHandling = (err, req, res, next) => {
  if (err instanceof AppError) {
    return res
      .status(err.statusCode)
      .json(buildErrorBody(err.statusCode, err.message, err.details, err));
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => e.message);
    return res
      .status(400)
      .json(buildErrorBody(400, "Validation error", details, err));
  }

  if (err instanceof mongoose.Error.CastError) {
    return res
      .status(400)
      .json(buildErrorBody(400, `Invalid ${err.path}`, null, err));
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res
      .status(409)
      .json(buildErrorBody(409, `Duplicate value for ${field}`, null, err));
  }

  if (err.cause && typeof err.cause === "number") {
    return res
      .status(err.cause)
      .json(buildErrorBody(err.cause, err.message, null, err));
  }

  // Unknown → 500 — structured log with full context
  logger.error(
    {
      err,
      reqId: req.id,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?._id,
    },
    "Unhandled error",
  );

  // Ship to Sentry (no-op if not configured). We attach a sanitized
  // context — never the full req object (which carries headers).
  const eventId = captureException(err, {
    reqId: req.id,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?._id?.toString(),
  });

  const body = buildErrorBody(500, "Internal Server Error", null, err);
  if (eventId) body.eventId = eventId;
  return res.status(500).json(body);
};
