import { Router } from "express";
import joi from "joi";
import reminderModel, {
  reminderStatus,
} from "../../DB/Model/reminder.model.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import { asyncHandler } from "../../utils/response/error.response.js";
import { successResponse } from "../../utils/response/success.response.js";
import { httpError } from "../../utils/errors/index.js";
import { isValidObjectId } from "../../middleware/validation.middleware.js";

const router = Router();
router.use(authentication());

const id = joi.string().custom(isValidObjectId).required();

const createReminder = joi
  .object({
    text: joi.string().trim().min(1).max(500).required(),
    triggerAt: joi.date().iso().greater("now").required(),
    sourceRoomId: joi.string().custom(isValidObjectId).optional(),
    sourceMessageId: joi.string().custom(isValidObjectId).optional(),
  })
  .required();

const reminderIdParam = joi.object({ reminderId: id }).required();

// POST /me/reminders
router.post(
  "/",
  validation(createReminder),
  asyncHandler(async (req, res) => {
    const r = await reminderModel.create({
      userId: req.user._id,
      text: req.body.text,
      triggerAt: new Date(req.body.triggerAt),
      sourceRoomId: req.body.sourceRoomId || null,
      sourceMessageId: req.body.sourceMessageId || null,
    });
    return successResponse({ res, status: 201, data: r });
  }),
);

// GET /me/reminders?status=pending|sent
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const filter = { userId: req.user._id };
    if (req.query.status) filter.status = req.query.status;
    const items = await reminderModel
      .find(filter)
      .sort({ triggerAt: 1 })
      .limit(200)
      .lean();
    return successResponse({ res, data: { items } });
  }),
);

// DELETE /me/reminders/:reminderId  — cancel a pending reminder
router.delete(
  "/:reminderId",
  validation(reminderIdParam),
  asyncHandler(async (req, res) => {
    const r = await reminderModel.findOne({
      _id: req.params.reminderId,
      userId: req.user._id,
    });
    if (!r) throw httpError(404, "Reminder not found");
    if (r.status !== reminderStatus.Pending) {
      throw httpError(409, `Cannot cancel — already ${r.status}`);
    }
    r.status = reminderStatus.Cancelled;
    await r.save();
    return successResponse({ res, message: "Reminder cancelled" });
  }),
);

export default router;
