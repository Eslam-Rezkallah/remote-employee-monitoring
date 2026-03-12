import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

// ── Create Project ────────────────────────────────────────────
export const createProject = joi
  .object()
  .keys({
    // from req.params
    orgId: generalFields.id.required(),

    // from req.body
    title: joi.string().trim().min(2).max(200).required(),
    description: joi.string().trim().max(2000).optional(),
    status: joi.string().valid("Active", "Completed", "Archived").optional(),
    startDate: joi.date().iso().optional(),
    endDate: joi.date().iso().min(joi.ref("startDate")).optional(),
    teamId: generalFields.id.required(),
    members: joi.array().items(generalFields.id).optional(),
  })
  .required();

// ── List Projects ─────────────────────────────────────────────
export const listProjects = joi
  .object()
  .keys({
    // from req.params
    orgId: generalFields.id.required(),

    // from req.query
    status: joi.string().valid("Active", "Completed", "Archived").optional(),
    search: joi.string().trim().max(200).optional(),
    teamId: generalFields.id.optional(),
    page: joi.number().integer().min(1).optional(),
    limit: joi.number().integer().min(1).max(100).optional(),
  })
  .required();

// ── Single project param ──────────────────────────────────────
export const projectParam = joi
  .object()
  .keys({
    orgId: generalFields.id.required(),
    projectId: generalFields.id.required(),
  })
  .required();

// ── Update Project info ───────────────────────────────────────
export const updateProject = joi
  .object()
  .keys({
    orgId: generalFields.id.required(),
    projectId: generalFields.id.required(),

    title: joi.string().trim().min(2).max(200).optional(),
    description: joi.string().trim().max(2000).allow(null).optional(),
    startDate: joi.date().iso().optional(),
    endDate: joi.date().iso().optional(),
  })
  .required();

// ── Update Status ─────────────────────────────────────────────
export const updateProjectStatus = joi
  .object()
  .keys({
    orgId: generalFields.id.required(),
    projectId: generalFields.id.required(),
    status: joi.string().valid("Active", "Completed", "Archived").required(),
  })
  .required();

// ── Transfer Manager ──────────────────────────────────────────
export const transferManager = joi
  .object()
  .keys({
    orgId: generalFields.id.required(),
    projectId: generalFields.id.required(),
    newManagerId: generalFields.id.required(),
  })
  .required();

// ── Add / Remove Member ───────────────────────────────────────
export const manageMember = joi
  .object()
  .keys({
    orgId: generalFields.id.required(),
    projectId: generalFields.id.required(),
    memberId: generalFields.id.required(),
  })
  .required();