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

// ── Task params (for routes that only need params) ───────────
export const taskParams = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    taskId: generalFields.id.required(),
  })
  .required();

// ── PATCH /tasks/:taskId  (general update) ───────────────────
// status + assigneeId are intentionally NOT here — they have dedicated
// endpoints so the access rules can be enforced per operation.
export const updateTask = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    taskId: generalFields.id.required(),

    title: joi.string().min(2).max(200).trim(),
    description: joi.string().allow("").max(5000),
    type: joi.string().valid(...Object.values(taskTypes)),
    priority: joi.string().valid(...Object.values(taskPriority)),
    labels: joi.array().items(joi.string().trim().max(30)).max(20),
    startDate: joi.date().iso().allow(null),
    parentTaskId: generalFields.id.allow(null),
    points: joi.number().integer().min(0).max(100),
    sprintId: generalFields.id.allow(null),
  })
  .or(
    "title",
    "description",
    "type",
    "priority",
    "labels",
    "startDate",
    "parentTaskId",
    "points",
    "sprintId",
  )
  .required();

// ── PATCH /tasks/:taskId/status ──────────────────────────────
export const changeTaskStatus = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    taskId: generalFields.id.required(),
    status: joi
      .string()
      .valid(...Object.values(taskStatus))
      .required(),
  })
  .required();

// ── PATCH /tasks/:taskId/assign ──────────────────────────────
// null clears the assignee.
export const assignTask = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    taskId: generalFields.id.required(),
    assigneeId: generalFields.id.allow(null).required(),
  })
  .required();

// ── Dependencies ─────────────────────────────────────────────
// POST /tasks/:taskId/dependencies   body: { blockerId }
export const addDependency = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    taskId: generalFields.id.required(),
    blockerId: generalFields.id.required(),
  })
  .required();

// DELETE /tasks/:taskId/dependencies/:blockerId
export const removeDependency = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    taskId: generalFields.id.required(),
    blockerId: generalFields.id.required(),
  })
  .required();
