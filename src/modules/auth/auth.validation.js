import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

export const signup = joi
  .object()
  .keys({
    username: generalFields.username.required(),
    email: generalFields.email.required(),
    password: generalFields.password.required(),
    confirmPassword: generalFields.confirmPassword.required(),
  })
  .required();

export const confirmEmail = joi
  .object()
  .keys({
    email: generalFields.email.required(),
    code: generalFields.code.required(),
  })
  .required();

export const login = joi
  .object()
  .keys({
    email: generalFields.email,
    phone: generalFields.phone,
    password: generalFields.password.required(),
  })
  .xor("email", "phone")
  .required();

export const forgetPassword = joi
  .object()
  .keys({
    email: generalFields.email.required(),
  })
  .required();

export const validateForgetPassword = confirmEmail;

export const resetPassword = joi
  .object()
  .keys({
    email: generalFields.email.required(),
    password: generalFields.password.required(),
    confirmPassword: generalFields.confirmPassword
      .valid(joi.ref("password"))
      .required(),
  })
  .required();

export const validateLoginOTP = joi
  .object()
  .keys({
    email: generalFields.email.required(),
    code: generalFields.code.required(),
  })
  .required();

export const verify2StepVerification = joi
  .object()
  .keys({
    email: generalFields.email.required(),
    code: generalFields.code.required(),
  })
  .required();

// FIX: removed ownerId — it comes from req.user._id (token), not the body
export const createOrganization = joi
  .object()
  .keys({
    name: joi.string().min(2).max(100).trim().required(),
    slug: joi
      .string()
      .min(2)
      .max(100)
      .lowercase()
      .trim()
      .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    logo: joi.string().uri().optional(),
  })
  .required();

export const joinOrganization = joi
  .object()
  .keys({
    email: generalFields.email.required(),
    password: generalFields.password.required(),
    joinCode: joi.string().length(8).uppercase().alphanum().required(),
  })
  .required();

export const sendConfirmEmail = joi
  .object()
  .keys({
    email: generalFields.email.required(),
  })
  .required();
export const refreshToken = joi
  .object()
  .keys({
    refreshToken: joi.string().required(),
  })
  .required();