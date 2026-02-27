import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";
import { taskTypes, taskStatus, taskPriority } from "../../DB/Model/task.model.js";

export const createTask = joi
  .object({
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
