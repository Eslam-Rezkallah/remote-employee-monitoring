import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import * as spaceService from "./service/space.service.js";
import * as calendarService from "../calendar/calendar.service.js";
import sprintController from "../sprint/sprint.controller.js";
import reportController from "../report/report.controller.js";
import metricsController from "../metrics/metrics.controller.js";


// ✅ NEW: task routes under a space
import taskController from "../task/task.controller.js";
// ✅ NEW: backlog + timeline handlers
import * as taskQueryService from "../task/service/task.query.service.js";

const router = Router({ mergeParams: true });

// Spaces
router.post("/", authentication(), spaceService.createSpace);
router.get("/", authentication(), spaceService.listSpaces);
router.get("/search", authentication(), spaceService.searchSpaces);
router.get("/:spaceId/calendar", authentication(), calendarService.calendar);

// ✅ Phase 4: Task module mounted under each space
// POST /org/:orgId/spaces/:spaceId/tasks
router.use("/:spaceId/tasks", taskController);

// ✅ Phase 4: Backlog + Timeline
// GET /org/:orgId/spaces/:spaceId/backlog
router.get("/:spaceId/backlog", authentication(), taskQueryService.backlog);

// GET /org/:orgId/spaces/:spaceId/timeline
router.get("/:spaceId/timeline", authentication(), taskQueryService.timeline);

router.use("/:spaceId/sprints", sprintController);
router.use("/:spaceId/reports", reportController);
router.use("/:spaceId/metrics", metricsController);

export default router;
