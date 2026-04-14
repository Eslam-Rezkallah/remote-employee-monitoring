import joi from "joi";

// GET /invite/accept?token=<hex>
export const validateToken = joi
  .object({
    token: joi.string().hex().length(64).required(),
  })
  .required();

// POST /invite/accept  { token }
export const acceptToken = joi
  .object({
    token: joi.string().hex().length(64).required(),
  })
  .required();
