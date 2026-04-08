import joi from "joi";
import { isValidObjectId } from "../../middleware/validation.middleware.js";
import { validReactions } from "../../DB/Model/reaction.model.js";

const id = joi.string().custom(isValidObjectId).required();

// ─────────────────────────────────────────────────────────────
// POST /chat/rooms/:roomId/messages/:messageId/reactions
// Add a reaction (allowed: 👍 ❤️ 😂 😮 😢 🔥 👏 😡)
// ─────────────────────────────────────────────────────────────
export const addReaction = joi
  .object({
    roomId: id.label("roomId"),
    messageId: id.label("messageId"),
    reaction: joi
      .string()
      .valid(...validReactions)
      .required(),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// DELETE /chat/rooms/:roomId/messages/:messageId/reactions
// Remove a reaction (user's own)
// ─────────────────────────────────────────────────────────────
export const removeReaction = joi
  .object({
    roomId: id.label("roomId"),
    messageId: id.label("messageId"),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// GET /chat/rooms/:roomId/messages/:messageId/reactions
// List reactions for a message
// ─────────────────────────────────────────────────────────────
export const listReactions = joi
  .object({
    roomId: id.label("roomId"),
    messageId: id.label("messageId"),
  })
  .required();
