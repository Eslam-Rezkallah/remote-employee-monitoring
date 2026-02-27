import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

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
}).required();

export const forYou = joi.object({
  orgId: generalFields.id,
  spaceId: generalFields.id,
  days: joi.number().integer().min(1).max(365).default(14),
  limit: joi.number().integer().min(1).max(50).default(15),
}).required();
