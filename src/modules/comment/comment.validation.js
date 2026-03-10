import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

export const createComment = joi
  .object()
  .keys({
    // from req.params (merged by validation middleware)
    taskId: generalFields.id.required(),

    // from req.body
    content: joi.string().trim().min(1).max(8000).required(),
    parentComment: generalFields.id.allow(null).optional(),
    mentions: joi.array().items(generalFields.id).optional(),
  })
  .required();

export const updateComment = joi
  .object()
  .keys({
    taskId: generalFields.id.required(),
    commentId: generalFields.id.required(),
    content: joi.string().trim().min(1).max(8000).required(),
  })
  .required();

export const deleteComment = joi
  .object()
  .keys({
    taskId:    generalFields.id.required(), 
    commentId: generalFields.id.required(),
  })
  .required();

export const getTaskComments = joi
  .object()
  .keys({
    // from req.params
    taskId: generalFields.id.required(),

    // from req.query
    page: joi.number().integer().min(1).optional(),
    limit: joi.number().integer().min(1).max(100).optional(),
  })
  .required();