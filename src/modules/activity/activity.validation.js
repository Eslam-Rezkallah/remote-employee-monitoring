import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

export const getOrgActivity = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id,
  actorId: generalFields.id,
  entityType: joi.string(),
  action: joi.string(),
  from: joi.date(),
  to: joi.date(),
  page: joi.number().integer().min(1).default(1),
  limit: joi.number().integer().min(1).max(100).default(20),
}).required();
