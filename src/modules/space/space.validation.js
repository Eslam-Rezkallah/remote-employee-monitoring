import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";
import { spaceTypes } from "../../DB/Model/space.model.js";
import {
  taskPriority,
  taskStatus,
  taskTypes,
} from "../../DB/Model/task.model.js";

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

export const spaceViews = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
}).required();

// GET / DELETE  → just IDs
export const spaceIdParam = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
}).required();

// PATCH /spaces/:spaceId — all fields optional
export const updateSpace = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
  name: joi.string().min(2).max(100).trim(),
  icon: joi.string().max(20).allow(""),
  type: joi.string().valid(...Object.values(spaceTypes)),
}).required();

export const statusSummary = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
}).required();

export const prioritySummary = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
}).required();

export const workloadSummary = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
}).required();

export const workTypeSummary = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
}).required();

export const epicProgressSummary = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
}).required();

export const timelineDataSummary = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
  from: joi.date().iso(),
  to: joi.date().iso().min(joi.ref("from")),
  status: joi.string().valid(...Object.values(taskStatus)),
  priority: joi.string().valid(...Object.values(taskPriority)),
  type: joi.string().valid(...Object.values(taskTypes)),
  assigneeId: generalFields.id,
  q: joi.string().min(1).max(200),
  page: joi.number().integer().min(1).default(1),
  limit: joi.number().integer().min(1).max(100).default(20),
}).required();

export const backlogSummary = joi.object({
  orgId: generalFields.id.required(),
  spaceId: generalFields.id.required(),
  status: joi.string().valid(...Object.values(taskStatus)),
  priority: joi.string().valid(...Object.values(taskPriority)),
  type: joi.string().valid(...Object.values(taskTypes)),
  assigneeId: generalFields.id,
  q: joi.string().min(1).max(200),
  page: joi.number().integer().min(1).default(1),
  limit: joi.number().integer().min(1).max(100).default(20),
}).required();
