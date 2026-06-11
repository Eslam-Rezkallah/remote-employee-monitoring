/**
 * modules/device/device.controller.js
 *
 * /me/devices — manage push notification tokens for the calling user.
 *
 *   POST   /me/devices         { token, platform, label? }     register
 *   GET    /me/devices                                          list mine
 *   DELETE /me/devices         { token }                        unregister one
 */

import { Router } from "express";
import joi from "joi";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import { asyncHandler } from "../../utils/response/error.response.js";
import { successResponse } from "../../utils/response/success.response.js";
import {
  registerDevice,
  unregisterDevice,
  listDevices,
} from "../../utils/push/push.service.js";
import { devicePlatforms } from "../../DB/Model/deviceToken.model.js";

const router = Router();
router.use(authentication());

const registerSchema = joi
  .object({
    // Tokens can be very long (web push subscription JSON), so we
    // allow up to 4KB.
    token: joi.string().trim().min(8).max(4096).required(),
    platform: joi
      .string()
      .valid(...Object.values(devicePlatforms))
      .required(),
    label: joi.string().trim().max(100).allow("", null),
  })
  .required();

const unregisterSchema = joi
  .object({ token: joi.string().trim().min(8).max(4096).required() })
  .required();

router.post(
  "/",
  validation(registerSchema),
  asyncHandler(async (req, res) => {
    const device = await registerDevice({
      userId: req.user._id,
      token: req.body.token,
      platform: req.body.platform,
      label: req.body.label || null,
    });
    return successResponse({
      res,
      message: "Device registered",
      data: { device },
    });
  }),
);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const devices = await listDevices({ userId: req.user._id });
    return successResponse({ res, data: { count: devices.length, devices } });
  }),
);

router.delete(
  "/",
  validation(unregisterSchema),
  asyncHandler(async (req, res) => {
    await unregisterDevice({ userId: req.user._id, token: req.body.token });
    return successResponse({ res, message: "Device unregistered" });
  }),
);

export default router;
