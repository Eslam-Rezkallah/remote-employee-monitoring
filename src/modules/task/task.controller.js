import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { activityLogging } from "../../middleware/activity.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as validators from "./task.validation.js";
import * as taskService from "./service/task.service.js";
import * as taskDates from "./service/task.dates.service.js";
import * as taskDeps from "./service/task.dependencies.service.js";


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

// ── Mutations ────────────────────────────────────────────────
// PATCH /tasks/:taskId  — general field updates
router.patch(
  "/:taskId",
  authentication(),
  activityLogging(),
  validation(validators.updateTask),
  taskService.updateTask,
);

// PATCH /tasks/:taskId/status  — Kanban transition
router.patch(
  "/:taskId/status",
  authentication(),
  activityLogging(),
  validation(validators.changeTaskStatus),
  taskService.changeStatus,
);

// PATCH /tasks/:taskId/assign  — assign / reassign / unassign
router.patch(
  "/:taskId/assign",
  authentication(),
  activityLogging(),
  validation(validators.assignTask),
  taskService.assignTask,
);

// DELETE /tasks/:taskId  — soft delete
router.delete(
  "/:taskId",
  authentication(),
  activityLogging(),
  validation(validators.taskParams),
  taskService.deleteTask,
);

// ── Dependencies (Jira-style blockedBy / blocks) ────────────
// GET    /tasks/:taskId/dependencies
router.get(
  "/:taskId/dependencies",
  authentication(),
  validation(validators.taskParams),
  taskDeps.listDependencies,
);
// POST   /tasks/:taskId/dependencies     body: { blockerId }
router.post(
  "/:taskId/dependencies",
  authentication(),
  activityLogging(),
  validation(validators.addDependency),
  taskDeps.addDependency,
);
// DELETE /tasks/:taskId/dependencies/:blockerId
router.delete(
  "/:taskId/dependencies/:blockerId",
  authentication(),
  activityLogging(),
  validation(validators.removeDependency),
  taskDeps.removeDependency,
);

// ── Epic tree (children of this task) ───────────────────────
// GET /tasks/:taskId/children
router.get(
  "/:taskId/children",
  authentication(),
  validation(validators.taskParams),
  taskDeps.listChildren,
);

export default router;
