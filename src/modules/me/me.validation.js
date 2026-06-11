import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

// GET /me/saved-messages?roomId=&page=&limit=
export const listMySavedMessages = joi
  .object({
    roomId: generalFields.id, // optional — filter to one room
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(100).default(20),
  })
  .required();

// GET /me/mentions?page=&limit=
export const listMyMentions = joi
  .object({
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(100).default(20),
  })
  .required();

export const assignedTasks = joi.object({
  orgId: generalFields.id,         // optional
  spaceId: generalFields.id,       // optional
  status: joi.string(),            // optional (Todo/InProgress/Done)
  priority: joi.string(),          // optional
  from: joi.date(),                // optional (dueDate filter)
  to: joi.date(),                  // optional (dueDate filter)
  page: joi.number().integer().min(1).default(1),
  limit: joi.number().integer().min(1).max(100).default(20),
}).required();

export const workedOnTasks = joi.object({
  orgId: generalFields.id,
  spaceId: generalFields.id,
  days: joi.number().integer().min(1).max(365).default(14),
  limit: joi.number().integer().min(1).max(100).default(30),
  useAI: joi.boolean().default(true),
}).required();

export const teamTasks = joi.object({
  orgId: generalFields.id,
  spaceId: generalFields.id,
  teamId: generalFields.id,
  status: joi.string(),
  priority: joi.string(),
  from: joi.date(),
  to: joi.date(),
  includeSelf: joi.boolean().default(false),
  page: joi.number().integer().min(1).default(1),
  limit: joi.number().integer().min(1).max(100).default(20),
}).required();

export const forYou = joi.object({
  orgId: generalFields.id,
  spaceId: generalFields.id,
  days: joi.number().integer().min(1).max(365).default(14),
  limit: joi.number().integer().min(1).max(50).default(15),
  useAI: joi.boolean().default(true),
}).required();
