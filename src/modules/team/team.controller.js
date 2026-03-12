import { Router } from "express";
import * as teamService from "./service/team.service.js";
import * as validators from "./team.validation.js";
import {
  authentication,
  authorization,
} from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import { roleTypes } from "../../DB/Model/user.model.js";

const router = Router();

// ── Create ────────────────────────────────────────────────────

// POST /teams
// Admin creates a new team
router.post(
  "/",
  authentication(),
  authorization([roleTypes.Admin]),
  validation(validators.createTeam),
  teamService.createTeam,
);

// ── Read ──────────────────────────────────────────────────────

// GET /teams
// List all teams the requesting user belongs to (Admin sees all)
router.get(
  "/",
  authentication(),
  validation(validators.listTeams),
  teamService.listTeams,
);

// GET /teams/:teamId
// Get a single team with full details
router.get(
  "/:teamId",
  authentication(),
  validation(validators.teamId),
  teamService.getTeam,
);

// ── Update ────────────────────────────────────────────────────

// PATCH /teams/:teamId
// Update team name / description (Admin or team manager)
router.patch(
  "/:teamId",
  authentication(),
  validation(validators.updateTeam),
  teamService.updateTeam,
);

// ── Members ───────────────────────────────────────────────────

// POST /teams/:teamId/members/:userId
// Add a member to the team (Admin or team manager)
router.post(
  "/:teamId/members/:userId",
  authentication(),
  validation(validators.manageUser),
  teamService.addMember,
);

// DELETE /teams/:teamId/members/:userId
// Remove a member from the team (Admin or team manager)
router.delete(
  "/:teamId/members/:userId",
  authentication(),
  validation(validators.manageUser),
  teamService.removeMember,
);

// ── Managers ──────────────────────────────────────────────────

// POST /teams/:teamId/managers/:userId
// Promote a member to manager (Admin only)
router.post(
  "/:teamId/managers/:userId",
  authentication(),
  authorization([roleTypes.Admin]),
  validation(validators.manageUser),
  teamService.addManager,
);

// DELETE /teams/:teamId/managers/:userId
// Demote a manager back to member (Admin only)
router.delete(
  "/:teamId/managers/:userId",
  authentication(),
  authorization([roleTypes.Admin]),
  validation(validators.manageUser),
  teamService.removeManager,
);

// ── Delete ────────────────────────────────────────────────────

// DELETE /teams/:teamId
// Soft-delete the team (Admin only)
router.delete(
  "/:teamId",
  authentication(),
  authorization([roleTypes.Admin]),
  validation(validators.teamId),
  teamService.deleteTeam,
);

export default router;