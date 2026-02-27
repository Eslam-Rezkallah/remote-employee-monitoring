import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as validators from "./me.validation.js";
import * as meService from "./service/me.service.js";

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
  "/for-you",
  authentication(),
  validation(validators.forYou),
  meService.forYou
);

export default router;
