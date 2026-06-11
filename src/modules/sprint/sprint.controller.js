import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { activityLogging } from "../../middleware/activity.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as validators from "./sprint.validation.js";
import * as sprintService from "./service/sprint.service.js";

const router = Router({ mergeParams: true });

// POST /org/:orgId/spaces/:spaceId/sprints
router.post(
  "/",
  authentication(),
  activityLogging(),
  validation(validators.createSprint),
  sprintService.createSprint
);

// GET /org/:orgId/spaces/:spaceId/sprints
router.get("/", authentication(), sprintService.listSprints);

// GET /org/:orgId/spaces/:spaceId/sprints/:sprintId
router.get("/:sprintId", authentication(), sprintService.getSprint);

// PATCH /org/:orgId/spaces/:spaceId/sprints/:sprintId
router.patch(
  "/:sprintId",
  authentication(),
  activityLogging(),
  sprintService.updateSprint
);

// DELETE /org/:orgId/spaces/:spaceId/sprints/:sprintId  (soft)
router.delete(
  "/:sprintId",
  authentication(),
  activityLogging(),
  sprintService.deleteSprint
);

export default router;
