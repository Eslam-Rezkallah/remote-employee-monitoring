import joi from "joi";
import { Types } from "mongoose";
// ✅ FIX: Correct import path (../../ instead of ../) and import roleTypes instead of non-existent genderTypes
import { roleTypes } from "../../DB/Model/user.model.js";

export const isValidObjectId = (value, helper) => {
  return Types.ObjectId.isValid(value)
    ? true
    : helper.message("invalid object");
};

export const validation = (Schema) => {
  return (req, res, next) => {
    const inputs = { ...req.query, ...req.body, ...req.params };
    if (req.file || req.files?.length) {
      inputs.file = req.file || req.files;
    }
    const validationResult = Schema.validate(inputs, { abortEarly: false });
    if (validationResult.error) {
      return res.status(400).json({
        message: "Validation error",
        details: validationResult.error.details,
      });
    }
    return next();
  };
};

const fileObj = {
  fieldname: joi.string().valid("attachment"),
  originalname: joi.string(),
  encoding: joi.string(),
  mimetype: joi.string(),
  size: joi.number(),
  path: joi.string(),
  filename: joi.string(),
  destination: joi.string(),
  finalPath: joi.string(),
};

export const generalFields = {
  username: joi.string().min(2).max(25),
  email: joi.string().email({
    minDomainSegments: 2,
    maxDomainSegments: 3,
    tlds: { allow: ["com", "net"] },
  }),
  password: joi
    .string()
    .pattern(
      new RegExp(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
      ),
    ),
  confirmPassword: joi.string().valid(joi.ref("password")),
  code: joi.string().pattern(new RegExp(/^\d{5}$/)),
  id: joi.string().custom(isValidObjectId),
  phone: joi.string().pattern(new RegExp(/^(\+2|002)?01[0125][0-9]{8}$/)),
  DOB: joi.date().less("now"),
  gender: joi.string().valid("Male", "Female", "Other"),
  address: joi.string(),
  fileObj,
  file: joi.object().keys(fileObj),
};
