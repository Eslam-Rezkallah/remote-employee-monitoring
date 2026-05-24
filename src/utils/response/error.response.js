import mongoose from "mongoose";
import { config } from "../../config/index.js";
import { AppError } from "../errors/index.js";

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Standardized error response body builder.
 */
const buildErrorBody = (statusCode, message, details, err) => {
  const body = {
    success: false,
    message,
    data: null,
  };
  if (details) body.details = details;
  if (config.app.isDev && statusCode >= 500 && err?.stack) {
    body.stack = err.stack;
  }
  return body;
};

export const globalErrorHandling = (err, req, res, next) => {
  // ── Typed AppError (preferred path) ─────────────────────
  if (err instanceof AppError) {
    return res
      .status(err.statusCode)
      .json(buildErrorBody(err.statusCode, err.message, err.details, err));
  }

  // ── Mongoose validation ─────────────────────────────────
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => e.message);
    return res
      .status(400)
      .json(buildErrorBody(400, "Validation error", details, err));
  }

  // ── Bad ObjectId ────────────────────────────────────────
  if (err instanceof mongoose.Error.CastError) {
    return res
      .status(400)
      .json(buildErrorBody(400, `Invalid ${err.path}`, null, err));
  }

  // ── Duplicate key ───────────────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res
      .status(409)
      .json(buildErrorBody(409, `Duplicate value for ${field}`, null, err));
  }

  // ── Legacy: Error with numeric cause (backward compat) ──
  // We keep this so partially-migrated code still works.
  if (err.cause && typeof err.cause === "number") {
    return res
      .status(err.cause)
      .json(buildErrorBody(err.cause, err.message, null, err));
  }

  // ── Unknown → 500 ───────────────────────────────────────
  // Phase 2 will replace console.error with structured logger.
  console.error("[UNHANDLED ERROR]", {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    requestId: req.id,
  });

  return res
    .status(500)
    .json(buildErrorBody(500, "Internal Server Error", null, err));
};
