import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

// ── Create Team ───────────────────────────────────────────────
// FIX: added organizationId as required — teams must belong to an org
export const createTeam = joi
  .object()
  .keys({
    organizationId: generalFields.id.required(),
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
    teamId: generalFields.id.required(),
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
// FIX: added organizationId as optional filter for listing teams within an org
export const listTeams = joi
  .object()
  .keys({
    organizationId: generalFields.id.optional(),
    search: joi.string().trim().max(100).optional(),
    page: joi.number().integer().min(1).optional(),
    limit: joi.number().integer().min(1).max(100).optional(),
  })
  .required();
