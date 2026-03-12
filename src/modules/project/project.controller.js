import { Router } from "express";
import * as projectService from "./service/project.service.js";
import * as validators from "./project.validation.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";

// mergeParams: true → inherits :orgId from App.controller mount
const router = Router({ mergeParams: true });

router.use(authentication());

// ── Create ────────────────────────────────────────────────────
// POST /org/:orgId/projects
// Allowed: team manager of the specified team OR org Admin/Owner
router.post(
  "/",
  validation(validators.createProject),
  projectService.createProject,
);

// ── Read ──────────────────────────────────────────────────────
// GET /org/:orgId/projects
router.get(
  "/",
  validation(validators.listProjects),
  projectService.listProjects,
);

// GET /org/:orgId/projects/:projectId
router.get(
  "/:projectId",
  validation(validators.projectParam),
  projectService.getProject,
);

// ── Update ────────────────────────────────────────────────────
// PATCH /org/:orgId/projects/:projectId
router.patch(
  "/:projectId",
  validation(validators.updateProject),
  projectService.updateProject,
);

// PATCH /org/:orgId/projects/:projectId/status
router.patch(
  "/:projectId/status",
  validation(validators.updateProjectStatus),
  projectService.updateProjectStatus,
);

// PATCH /org/:orgId/projects/:projectId/manager
// Org Admin/Owner only
router.patch(
  "/:projectId/manager",
  validation(validators.transferManager),
  projectService.transferManager,
);

// ── Members ───────────────────────────────────────────────────
// POST /org/:orgId/projects/:projectId/members/:memberId
router.post(
  "/:projectId/members/:memberId",
  validation(validators.manageMember),
  projectService.addMember,
);

// DELETE /org/:orgId/projects/:projectId/members/:memberId
router.delete(
  "/:projectId/members/:memberId",
  validation(validators.manageMember),
  projectService.removeMember,
);

// ── Delete ────────────────────────────────────────────────────
// DELETE /org/:orgId/projects/:projectId
// Org Admin/Owner only
router.delete(
  "/:projectId",
  validation(validators.projectParam),
  projectService.deleteProject,
);

export default router;