import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

export const profileImage = joi
  .object()
  .keys({
    file: generalFields.file.required(),
  })
  .required();

export const shareProfile = joi
  .object()
  .keys({
    profileId: generalFields.id.required(),
  })
  .required();

export const updateEmail = joi
  .object()
  .keys({
    email: generalFields.email.required(),
  })
  .required();

export const resetEmail = joi
  .object()
  .keys({
    oldCode: generalFields.code.required(),
    newCode: generalFields.code.required(),
  })
  .required();

export const updatePassword = joi
  .object()
  .keys({
    oldPassword: generalFields.password.required(),
    password: generalFields.password.not(joi.ref("oldPassword")).required(),
    confirmPassword: generalFields.confirmPassword
      .valid(joi.ref("password"))
      .required(),
  })
  .required();

export const updateProfile = joi
  .object()
  .keys({
    username: generalFields.username,
    gender: generalFields.gender,
    DOB: generalFields.DOB,
    address: generalFields.address,
    phone: generalFields.phone,
  })
  .required();

export const enableTwoStepVerification = joi
  .object()
  .keys({
    email: generalFields.email.required(),
  })
  .required();

export const disabledTwoStepVerification = joi
  .object()
  .keys({
    email: generalFields.email.required(),
  })
  .required();

export const changeRole = joi
  .object()
  .keys({
    userId: generalFields.id.required(),
    role: joi.string().valid("Admin", "Manager", "Member").required(),
  })
  .required();

export const toggleReadReceipts = joi
  .object()
  .keys({
    enabled: joi.boolean().required(),
  })
  .required();
