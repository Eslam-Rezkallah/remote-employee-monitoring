import joi from "joi";
import { sprintStatus } from "../../DB/Model/sprint.model.js";
import { generalFields } from "../../middleware/validation.middleware.js";

export const createSprint = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
  name: joi.string().min(2).max(100).trim().required(),
  goal: joi.string().allow("").max(2000),
  startDate: joi.date().required(),
  endDate: joi.date().required(),
}).required();

export const updateSprintStatus = joi.object({
  sprintId: generalFields.id.required(),
  status: joi.string().valid(...Object.values(sprintStatus)).required(),
}).required();

export const sprintIdParam = joi.object({
  sprintId: generalFields.id.required(),
}).required();
