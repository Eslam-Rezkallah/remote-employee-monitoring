import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

// ── List / filter notifications ───────────────────────────────
export const listNotifications = joi
  .object()
  .keys({
    isRead: joi.boolean().optional(),
    page: joi.number().integer().min(1).optional(),
    limit: joi.number().integer().min(1).max(100).optional(),
  })
  .required();

// ── Single notification by ID ─────────────────────────────────
export const notificationId = joi
  .object()
  .keys({
    notificationId: generalFields.id.required(),
  })
  .required();