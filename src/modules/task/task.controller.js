import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as validators from "./task.validation.js";
import * as taskService from "./service/task.service.js";
import * as taskDates from "./service/task.dates.service.js";


const router = Router({ mergeParams: true });

// POST /org/:orgId/spaces/:spaceId/tasks
router.post("/", authentication(), validation(validators.createTask), taskService.createTask);
// PATCH /tasks/:taskId/due-date
router.patch("/:taskId/due-date", authentication(), taskDates.updateDueDate);

router.get("/", authentication(), taskService.listTasks);
router.get("/backlog", authentication(), taskService.backlog);
router.get("/:taskId", authentication(), taskService.getTask);

export default router;
