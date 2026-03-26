import joi from "joi";
import { isValidObjectId } from "../../middleware/validation.middleware.js";

// ── Reusable ──────────────────────────────────────────────────
const id = joi.string().custom(isValidObjectId).required();
const optionalId = joi.string().custom(isValidObjectId);

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/messages
// Send a message
// ─────────────────────────────────────────────────────────────
export const sendMessage = joi
  .object({
    roomId: id.label("roomId"),
    content: joi.string().max(5000).allow("").default(""),
    messageType: joi
      .string()
      .valid("text", "image", "voice", "file", "system")
      .default("text"),
    replyTo: optionalId,
    // file validation handled by multer; schema allows file metadata
    file: joi.object().unknown(true),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/messages
// List messages (paginated)
// ─────────────────────────────────────────────────────────────
export const listMessages = joi
  .object({
    roomId: id.label("roomId"),
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(100).default(30),
    before: joi.date().iso(), // cursor-based: fetch messages before this date
  })
  .required();

// ─────────────────────────────────────────────────────────────
// PATCH /chat/rooms/:roomId/messages/:messageId
// Edit a message
// ─────────────────────────────────────────────────────────────
export const editMessage = joi
  .object({
    roomId: id.label("roomId"),
    messageId: id.label("messageId"),
    content: joi.string().max(5000).min(1).required(),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// DELETE /chat/rooms/:roomId/messages/:messageId
// Delete a message
// ─────────────────────────────────────────────────────────────
export const deleteMessage = joi
  .object({
    roomId: id.label("roomId"),
    messageId: id.label("messageId"),
    deleteType: joi.string().valid("me", "everyone").default("me"),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// PATCH /chat/rooms/:roomId/messages/:messageId/seen
// Mark message as seen
// ─────────────────────────────────────────────────────────────
export const markSeen = joi
  .object({
    roomId: id.label("roomId"),
    messageId: id.label("messageId"),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// Message + Room param
// ─────────────────────────────────────────────────────────────
export const messageParam = joi
  .object({
    roomId: id.label("roomId"),
    messageId: id.label("messageId"),
  })
  .required();
