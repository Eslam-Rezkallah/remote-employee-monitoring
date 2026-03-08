import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createOrg = joi.object({
  name: joi.string().min(2).max(100).trim().required(),
  slug: joi.string().min(2).max(100).lowercase().trim().pattern(slugRegex),
  logo: joi.string().uri(),
  file: joi.any(),
}).required();

export const updateOrg = joi.object({
  orgId: generalFields.id.required(),
  name: joi.string().min(2).max(100).trim(),
  slug: joi.string().min(2).max(100).lowercase().trim().pattern(slugRegex),
  logo: joi.string().uri(),
  file: joi.any(),
}).required();

export const orgIdParam = joi.object({
  orgId: generalFields.id.required(),
}).required();

export const createInvitation = joi
  .object({
    orgId: generalFields.id.required(),
    email: generalFields.email.required(),
    role: joi.string().valid("admin", "member").default("member"),
  })
  .required();

export const validateInvitation = joi
  .object({
    token: joi.string().hex().length(64).required(),
  })
  .required();

export const acceptInvitation = joi
  .object({
    token: joi.string().hex().length(64).required(),
  })
  .required();
