import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { activityLogging } from "../../middleware/activity.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as validators from "./sprint.validation.js";
import * as sprintService from "./service/sprint.service.js";

const router = Router();

// PATCH /sprints/:sprintId/status
router.patch(
  "/:sprintId/status",
  authentication(),
  activityLogging(),
  validation(validators.updateSprintStatus),
  sprintService.updateSprintStatus
);

export default router;
