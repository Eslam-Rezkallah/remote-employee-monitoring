import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as spaceService from "./service/space.service.js";
import * as validators from "./space.validation.js";
import * as calendarService from "../calendar/calendar.service.js";
import sprintController from "../sprint/sprint.controller.js";
import reportController from "../report/report.controller.js";
import metricsController from "../metrics/metrics.controller.js";
import * as taskWorkflowService from "../task/service/task.workflow.service.js";
import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";


// ✅ NEW: task routes under a space
import taskController from "../task/task.controller.js";
// ✅ NEW: backlog + timeline handlers
import * as taskQueryService from "../task/service/task.query.service.js";

const router = Router({ mergeParams: true });

// Spaces
router.post("/", authentication(), validation(validators.createSpace), spaceService.createSpace);
router.get("/", authentication(), validation(validators.listSpaces), spaceService.listSpaces);
router.get("/search", authentication(), validation(validators.searchSpaces), spaceService.searchSpaces);

// GET single, PATCH update, DELETE soft — registered before the
// summary routes so /:spaceId/summary/* still matches first.
router.get("/:spaceId", authentication(), validation(validators.spaceIdParam), spaceService.getSpace);
router.patch("/:spaceId", authentication(), validation(validators.updateSpace), spaceService.updateSpace);
router.delete("/:spaceId", authentication(), validation(validators.spaceIdParam), spaceService.deleteSpace);
router.get(
  "/:spaceId/summary/status",
  authentication(),
  validation(validators.statusSummary),
  spaceService.statusSummary
);
router.get(
  "/:spaceId/summary/priority",
  authentication(),
  validation(validators.prioritySummary),
  spaceService.prioritySummary
);
router.get(
  "/:spaceId/summary/workload",
  authentication(),
  validation(validators.workloadSummary),
  spaceService.workloadSummary
);
router.get(
  "/:spaceId/summary/work-type",
  authentication(),
  validation(validators.workTypeSummary),
  spaceService.workTypeSummary
);
router.get(
  "/:spaceId/summary/epic-progress",
  authentication(),
  validation(validators.epicProgressSummary),
  spaceService.epicProgressSummary
);
router.get(
  "/:spaceId/summary/timeline-data",
  authentication(),
  validation(validators.timelineDataSummary),
  spaceService.timelineDataSummary
);
router.get(
  "/:spaceId/summary/backlog",
  authentication(),
  validation(validators.backlogSummary),
  spaceService.backlogSummary
);
router.get(
  "/:spaceId/views",
  authentication(),
  validation(validators.spaceViews),
  spaceService.getSpaceViews
);
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

// ── Per-space custom workflow (Kanban columns) ──────────────
const workflowParam = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
  })
  .required();

const upsertWorkflowSchema = joi
  .object({
    orgId: generalFields.id.required(),
    spaceId: generalFields.id.required(),
    name: joi.string().trim().max(100),
    statuses: joi
      .array()
      .min(2)
      .items(
        joi.object({
          key: joi.string().trim().min(1).max(40).required(),
          label: joi.string().trim().min(1).max(60).required(),
          category: joi
            .string()
            .valid("todo", "in_progress", "done")
            .required(),
          color: joi.string().max(20).allow("", null),
          isDefault: joi.boolean().default(false),
        }),
      )
      .required(),
  })
  .required();

router.get(
  "/:spaceId/workflow",
  authentication(),
  validation(workflowParam),
  taskWorkflowService.getWorkflow,
);
router.post(
  "/:spaceId/workflow",
  authentication(),
  validation(upsertWorkflowSchema),
  taskWorkflowService.upsertWorkflow,
);
router.delete(
  "/:spaceId/workflow",
  authentication(),
  validation(workflowParam),
  taskWorkflowService.deleteWorkflow,
);

export default router;
