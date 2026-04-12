import joi from "joi";
import { generalFields } from "../../middleware/validation.middleware.js";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─────────────────────────────────────────────────────────────
// ORG CRUD
// ─────────────────────────────────────────────────────────────

export const createOrg = joi
  .object({
    name: joi.string().min(2).max(100).trim().required(),
    slug: joi
      .string()
      .min(2)
      .max(100)
      .lowercase()
      .trim()
      .pattern(slugRegex)
      .optional(),
    logo: joi.string().uri().optional(),
    file: joi.any().optional(),
  })
  .required();

export const updateOrg = joi
  .object({
    orgId: generalFields.id.required(),
    name: joi.string().min(2).max(100).trim().optional(),
    slug: joi
      .string()
      .min(2)
      .max(100)
      .lowercase()
      .trim()
      .pattern(slugRegex)
      .optional(),
    logo: joi.string().uri().optional(),
    file: joi.any().optional(),
  })
  .required();

export const orgIdParam = joi
  .object({
    orgId: generalFields.id.required(),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// MEMBERS
// ─────────────────────────────────────────────────────────────

export const listMembers = joi
  .object({
    orgId: generalFields.id.required(),
    role: joi.string().valid("owner", "admin", "member").optional(),
    q: joi.string().trim().max(100).optional(),
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(100).default(20),
  })
  .required();

export const changeMemberRole = joi
  .object({
    orgId: generalFields.id.required(),
    memberId: generalFields.id.required(),
    role: joi.string().valid("admin", "member").required(),
  })
  .required();

export const removeMemberParam = joi
  .object({
    orgId: generalFields.id.required(),
    memberId: generalFields.id.required(),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// WORK SESSIONS (admin monitoring)
// ─────────────────────────────────────────────────────────────

export const orgWorkSessions = joi
  .object({
    orgId: generalFields.id.required(),
    userId: generalFields.id.optional(),
    status: joi.string().valid("active", "paused", "stopped").optional(),
    from: joi.date().iso().optional(),
    to: joi.date().iso().min(joi.ref("from")).optional(),
    page: joi.number().integer().min(1).default(1),
    limit: joi.number().integer().min(1).max(100).default(20),
  })
  .required();

export const orgWorkSessionsSummary = joi
  .object({
    orgId: generalFields.id.required(),
    from: joi.date().iso().optional(),
    to: joi.date().iso().optional(),
  })
  .required();

// ─────────────────────────────────────────────────────────────
// INVITATIONS
// ─────────────────────────────────────────────────────────────

export const createInvitation = joi
  .object({
    orgId: generalFields.id.required(),
    email: generalFields.email.required(),
    role: joi.string().valid("admin", "member").default("member"),
  })
  .required();

export const validateInvitation = joi
  .object({
    token: joi.string().hex().length(64).required(),
  })
  .required();

export const acceptInvitation = joi
  .object({
    token: joi.string().hex().length(64).required(),
  })
  .required();
