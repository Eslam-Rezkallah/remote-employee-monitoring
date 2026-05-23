import mongoose from "mongoose";
import { config } from "../../config/index.js";
import { AppError } from "../errors/index.js";

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const globalErrorHandling = (err, req, res, next) => {
  // ── New typed errors ──────────────────────────────────
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details && { details: err.details }),
    });
  }

  // ── Mongoose validation errors → 400 ──────────────────
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      success: false,
      message: "Validation error",
      details: Object.values(err.errors).map((e) => e.message),
    });
  }

  // ── Bad ObjectId → 400 ────────────────────────────────
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      message: `Invalid ${err.path}`,
    });
  }

  // ── Duplicate key → 409 ───────────────────────────────
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    return res.status(409).json({
      success: false,
      message: `Duplicate value for ${field}`,
    });
  }

  // ── Legacy errors (keep working during migration) ─────
  if (err.cause && typeof err.cause === "number") {
    return res.status(err.cause).json({
      success: false,
      message: err.message,
    });
  }

  // ── Unknown error → 500, never leak stack in prod ─────
  console.error("[UNHANDLED ERROR]", err);
  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
    ...(config.app.isDev && { stack: err.stack }),
  });
};
