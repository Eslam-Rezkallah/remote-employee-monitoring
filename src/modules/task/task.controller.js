import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { activityLogging } from "../../middleware/activity.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as validators from "./task.validation.js";
import * as taskService from "./service/task.service.js";
import * as taskDates from "./service/task.dates.service.js";


const router = Router({ mergeParams: true });

// POST /org/:orgId/spaces/:spaceId/tasks
router.post(
  "/",
  authentication(),
  activityLogging(),
  validation(validators.createTask),
  taskService.createTask
);
// PATCH /tasks/:taskId/due-date
router.patch(
  "/:taskId/due-date",
  authentication(),
  validation(validators.updateDueDate),
  taskDates.updateDueDate
);
router.get(
  "/due-dates",
  authentication(),
  validation(validators.listDueDates),
  taskDates.listDueDates
);
router.patch(
  "/due-dates/bulk",
  authentication(),
  validation(validators.bulkUpdateDueDates),
  taskDates.bulkUpdateDueDates
);

router.get("/", authentication(), taskService.listTasks);
router.get("/backlog", authentication(), taskService.backlog);
router.get("/:taskId", authentication(), taskService.getTask);

export default router;
