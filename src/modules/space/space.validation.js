import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";
import { spaceTypes } from "../../DB/Model/space.model.js";

export const createSpace = joi.object({
  orgId: generalFields.id.required(), // params
  name: joi.string().min(2).max(100).trim().required(),
  icon: joi.string().max(20).allow(""),
  type: joi.string().valid(...Object.values(spaceTypes)).default(spaceTypes.Project),
}).required();

export const listSpaces = joi.object({
  orgId: generalFields.id.required(), // params
  type: joi.string().valid(...Object.values(spaceTypes)),
  q: joi.string().min(1).max(100),
  page: joi.number().integer().min(1).default(1),
  limit: joi.number().integer().min(1).max(100).default(20),
}).required();

export const searchSpaces = joi.object({
  orgId: generalFields.id.required(), // params
  q: joi.string().min(1).max(100).required(),
  limit: joi.number().integer().min(1).max(50).default(20),
}).required();
