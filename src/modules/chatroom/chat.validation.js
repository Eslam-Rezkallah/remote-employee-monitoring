import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

export const createChatRoom = joi
  .object({
    type: joi.string().valid("private", "group", "project").required(),
    name: joi.string().when("type", {
      is: "group",
      then: joi.required(),
    }),
    projectId: joi.string().when("type", {
      is: "project",
      then: joi.required(),
    }),
    members: joi
      .array()
      .items(generalFields.id)
      .when("type", {
        is: joi.valid("group", "project"),
        then: joi.required(),
      }),
    orgId: generalFields.id.required(),
  })
  .required();

export const sendMessage = joi
  .object({
    chatRoomId: generalFields.id.required(),
    content: joi.string().required(),
    replyTo: generalFields.id,
    mentions: joi.array().items(generalFields.id),
  })
  .required();

export const editMessage = joi
  .object({
    messageId: generalFields.id.required(),
    content: joi.string().required(),
  })
  .required();

export const deleteMessage = joi
  .object({
    messageId: generalFields.id.required(),
  })
  .required();

export const pinMessage = joi
  .object({
    messageId: generalFields.id.required(),
    pin: joi.boolean().required(),
  })
  .required();

export const addReaction = joi
  .object({
    messageId: generalFields.id.required(),
    emoji: joi.string().required(),
  })
  .required();

export const searchMessages = joi
  .object({
    chatRoomId: generalFields.id.required(),
    query: joi.string().required(),
    page: joi.number().default(1),
    limit: joi.number().default(20),
  })
  .required();

export const getMessages = joi
  .object({
    chatRoomId: generalFields.id.required(),
    page: joi.number().default(1),
    limit: joi.number().default(20),
  })
  .required();

export const getChatRooms = joi
  .object({
    orgId: generalFields.id.required(),
    type: joi.string().valid("private", "group", "project"),
    page: joi.number().default(1),
    limit: joi.number().default(20),
  })
  .required();
