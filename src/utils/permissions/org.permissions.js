import memberModel, { memberRoles } from "../../DB/Model/member.model.js";
import * as dbService from "../../DB/db.service.js";
import { ForbiddenError } from "../errors/index.js";

/**
 * Returns the user's org membership if they are active, otherwise throws.
 * Use this as the first check in any org-scoped endpoint.
 */
export async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });

  if (!member) {
    throw new ForbiddenError("Not a member of this organization");
  }

  return member;
}

/**
 * Requires the user to be an owner OR admin of the org.
 */
export async function requireOrgAdmin(orgId, userId) {
  const member = await requireOrgMember(orgId, userId);

  if (![memberRoles.Owner, memberRoles.Admin].includes(member.role)) {
    throw new ForbiddenError(
      "Only organization owner or admin can perform this action",
    );
  }

  return member;
}

/**
 * Requires the user to be the org owner (for destructive actions like delete).
 */
export async function requireOrgOwner(orgId, userId) {
  const member = await requireOrgMember(orgId, userId);

  if (member.role !== memberRoles.Owner) {
    throw new ForbiddenError(
      "Only the organization owner can perform this action",
    );
  }

  return member;
}

/**
 * Helper: checks if a membership role is admin-level (owner OR admin).
 * Use when you already have the membership object.
 */
export function isOrgAdminOrOwner(membership) {
  if (!membership) return false;
  return [memberRoles.Owner, memberRoles.Admin].includes(membership.role);
  
}
