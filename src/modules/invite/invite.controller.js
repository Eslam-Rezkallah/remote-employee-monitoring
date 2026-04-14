/**
 * modules/invite/invite.controller.js
 *
 * Public-facing invitation routes.
 * The email sends users to:  GET /invite/accept?token=<hex>
 *
 * ── Flow ────────────────────────────────────────────────────
 *  1. GET  /invite/accept?token=   → validate & preview (no auth)
 *  2. POST /invite/accept          → accept invitation  (auth required)
 * ────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import * as inviteService from "./service/invite.service.js";
import * as validators from "./invite.validation.js";

const router = Router();

// ─────────────────────────────────────────────────────────────
// GET /invite/accept?token=<64-char hex>
// No auth — anyone with the link can preview the invitation.
// Returns: org name, role, expiry, status
// ─────────────────────────────────────────────────────────────
router.get(
  "/accept",
  validation(validators.validateToken),
  inviteService.previewInvitation,
);

// ─────────────────────────────────────────────────────────────
// POST /invite/accept   { token: "<64-char hex>" }
// Auth required — the logged-in user accepts the invitation.
// ─────────────────────────────────────────────────────────────
router.post(
  "/accept",
  authentication(),
  validation(validators.acceptToken),
  inviteService.acceptInvitation,
);

export default router;
