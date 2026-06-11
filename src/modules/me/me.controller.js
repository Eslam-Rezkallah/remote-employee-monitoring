import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as validators from "./me.validation.js";
import * as meService from "./service/me.service.js";
import * as messageExtras from "../message/service/message.extras.service.js";
import * as notifPrefs from "../notification/service/preferences.service.js";
import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

const router = Router();

router.get(
  "/tasks/assigned",
  authentication(),
  validation(validators.assignedTasks),
  meService.assignedTasks
);

router.get(
  "/tasks/worked-on",
  authentication(),
  validation(validators.workedOnTasks),
  meService.workedOnTasks
);

router.get(
  "/tasks/team",
  authentication(),
  validation(validators.teamTasks),
  meService.teamTasks
);

router.get(
  "/for-you",
  authentication(),
  validation(validators.forYou),
  meService.forYou
);

// ── Bookmarks (saved chat messages) ─────────────────────────
// GET /me/saved-messages?roomId=&page=&limit=
router.get(
  "/saved-messages",
  authentication(),
  validation(validators.listMySavedMessages),
  messageExtras.listMySavedMessages,
);

// ── Mentions inbox ──────────────────────────────────────────
// GET /me/mentions?page=&limit=
router.get(
  "/mentions",
  authentication(),
  validation(validators.listMyMentions),
  messageExtras.listMyMentions,
);

// ── Notification preferences ────────────────────────────────
const prefsUpdateSchema = joi
  .object({
    inApp: joi.boolean(),
    push: joi.boolean(),
    email: joi.boolean(),
    muted: joi.boolean(),
    // "HH:mm" 24-hour, e.g. "22:00"
    quietHoursStart: joi
      .string()
      .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
      .allow(null),
    quietHoursEnd: joi
      .string()
      .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
      .allow(null),
    quietHoursTimezone: joi.string().max(64),
    byType: joi
      .array()
      .items(
        joi.object({
          type: joi.string().min(1).max(60).required(),
          inApp: joi.boolean(),
          push: joi.boolean(),
          email: joi.boolean(),
        }),
      )
      .max(50),
  })
  .min(1)
  .required();

router.get(
  "/notification-preferences",
  authentication(),
  notifPrefs.getMyPreferences,
);
router.patch(
  "/notification-preferences",
  authentication(),
  validation(prefsUpdateSchema),
  notifPrefs.updateMyPreferences,
);

export default router;
