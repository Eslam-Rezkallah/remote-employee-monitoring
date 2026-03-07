import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";
import { taskTypes, taskStatus, taskPriority } from "../../DB/Model/task.model.js";

export const createTask = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    title: joi.string().min(2).max(200).trim().required(),
    description: joi.string().allow("").max(5000),
    type: joi.string().valid(...Object.values(taskTypes)),
    status: joi.string().valid(...Object.values(taskStatus)),
    priority: joi.string().valid(...Object.values(taskPriority)),
    assigneeId: generalFields.id,
    startDate: joi.date(),
    dueDate: joi.date(),
    labels: joi.array().items(joi.string().trim().max(30)).max(20),
    parentTaskId: generalFields.id.allow(null),
  })
  .required();

export const updateDueDate = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    taskId: generalFields.id.required(),
    dueDate: joi.date().iso().allow(null).required(),
  })
  .required();

export const listDueDates = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    from: joi.date().iso(),
    to: joi.date().iso().min(joi.ref("from")),
    status: joi.string().valid(...Object.values(taskStatus)),
    priority: joi.string().valid(...Object.values(taskPriority)),
    assigneeId: generalFields.id,
    q: joi.string().min(1).max(200),
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(100).default(20),
  })
  .required();

export const bulkUpdateDueDates = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    updates: joi
      .array()
      .items(
        joi.object({
          taskId: generalFields.id.required(),
          dueDate: joi.date().iso().allow(null).required(),
        })
      )
      .min(1)
      .max(200)
      .required(),
  })
  .required();
