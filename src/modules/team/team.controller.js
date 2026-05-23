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
// FIX: removed authorization([roleTypes.Admin]) — the service now
//      checks org-level roles (owner/admin) via requireOrgMember().
//      System Admin can still create teams because isManagerOrAdmin()
//      checks user.role === Admin as a fallback.
router.post(
  "/",
  authentication(),
  validation(validators.createTeam),
  teamService.createTeam,
);

// ── Read ──────────────────────────────────────────────────────
router.get(
  "/",
  authentication(),
  validation(validators.listTeams),
  teamService.listTeams,
);

router.get(
  "/:teamId",
  authentication(),
  validation(validators.teamId),
  teamService.getTeam,
);

// ── Update ────────────────────────────────────────────────────
router.patch(
  "/:teamId",
  authentication(),
  validation(validators.updateTeam),
  teamService.updateTeam,
);

// ── Members ───────────────────────────────────────────────────
router.post(
  "/:teamId/members/:userId",
  authentication(),
  validation(validators.manageUser),
  teamService.addMember,
);

router.delete(
  "/:teamId/members/:userId",
  authentication(),
  validation(validators.manageUser),
  teamService.removeMember,
);

// ── Managers ──────────────────────────────────────────────────
router.delete(
  "/:teamId",
  authentication(),
  validation(validators.teamId),
  teamService.deleteTeam,
);

router.post(
  "/:teamId/managers/:userId",
  authentication(),
  validation(validators.manageUser),
  teamService.addManager,
);

router.delete(
  "/:teamId/managers/:userId",
  authentication(),
  validation(validators.manageUser),
  teamService.removeManager,
);

export default router;
