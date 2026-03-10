import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

// ── Create Team ───────────────────────────────────────────────
export const createTeam = joi
  .object()
  .keys({
    name: joi.string().trim().min(2).max(100).required(),
    description: joi.string().trim().max(500).optional(),
    members: joi.array().items(generalFields.id).optional(),
    managers: joi.array().items(generalFields.id).optional(),
  })
  .required();

// ── Update Team info ──────────────────────────────────────────
export const updateTeam = joi
  .object()
  .keys({
    // from req.params
    teamId: generalFields.id.required(),

    // from req.body
    name: joi.string().trim().min(2).max(100).optional(),
    description: joi.string().trim().max(500).optional(),
  })
  .required();

// ── Single team param ─────────────────────────────────────────
export const teamId = joi
  .object()
  .keys({
    teamId: generalFields.id.required(),
  })
  .required();

// ── Add / Remove member or manager ───────────────────────────
export const manageUser = joi
  .object()
  .keys({
    teamId: generalFields.id.required(),
    userId: generalFields.id.required(),
  })
  .required();

// ── List teams (query filters) ────────────────────────────────
export const listTeams = joi
  .object()
  .keys({
    search: joi.string().trim().max(100).optional(),
    page: joi.number().integer().min(1).optional(),
    limit: joi.number().integer().min(1).max(100).optional(),
  })
  .required();