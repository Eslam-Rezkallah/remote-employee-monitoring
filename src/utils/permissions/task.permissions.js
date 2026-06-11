/**
 * Task-level access control.
 *
 * Hierarchy of rights (least → most powerful):
 *   anyone in the org            → can READ tasks
 *   assignee | reporter | admin  → can EDIT task fields, due date, status
 *   reporter | admin             → can ASSIGN / REASSIGN
 *   reporter | admin             → can DELETE
 *
 * Org admin/owner always wins. The reasoning:
 *   - assignee shouldn't be able to delete the task assigned to them
 *     (it would let them dodge accountability)
 *   - assignee shouldn't reassign themselves away — that's a workflow
 *     decision the reporter or a manager makes
 *
 * Each check returns the membership object on success and throws an
 * AppError otherwise, so callers can also use the returned role for
 * downstream decisions.
 */

import { memberRoles } from "../../DB/Model/member.model.js";
import { httpError } from "../errors/index.js";
import { requireOrgMember } from "./org.permissions.js";

const sameId = (a, b) => a && b && a.toString() === b.toString();

const isOrgAdminOrOwner = (membership) =>
  !!membership &&
  [memberRoles.Admin, memberRoles.Owner].includes(membership.role);

// Legacy alias. Both names point at the same implementation so we
// keep callers compiling AND have a local binding the in-file
// functions below can reference (export-only would leave the name
// unbound inside the module — which broke the unit tests).
const requireOrgMembership = requireOrgMember;
export { requireOrgMember as requireOrgMembership };

/**
 * Edit = update fields, change due date, change status.
 * Allowed: assignee, reporter, org admin/owner.
 */
export async function requireTaskEditAccess({ task, orgId, userId }) {
  const membership = await requireOrgMembership(orgId, userId);

  const isAssignee = sameId(task.assigneeId, userId);
  const isReporter = sameId(task.reporterId, userId);

  if (isAssignee || isReporter || isOrgAdminOrOwner(membership)) {
    return { membership, isAssignee, isReporter };
  }

  throw httpError(
    403,
    "Only the task assignee, reporter, or an organization admin can edit this task",
  );
}

/**
 * Assign / reassign / unassign.
 * Allowed: reporter, org admin/owner.
 * NOT the assignee — they don't get to hand off their own work
 * unilaterally; that's the reporter or a manager's call.
 */
export async function requireTaskAssignAccess({ task, orgId, userId }) {
  const membership = await requireOrgMembership(orgId, userId);

  const isReporter = sameId(task.reporterId, userId);

  if (isReporter || isOrgAdminOrOwner(membership)) {
    return { membership, isReporter };
  }

  throw httpError(
    403,
    "Only the task reporter or an organization admin can change the assignee",
  );
}

/**
 * Delete (soft).
 * Allowed: reporter, org admin/owner.
 * Assignee can't delete — would let them avoid accountability.
 */
export async function requireTaskDeleteAccess({ task, orgId, userId }) {
  const membership = await requireOrgMembership(orgId, userId);

  const isReporter = sameId(task.reporterId, userId);

  if (isReporter || isOrgAdminOrOwner(membership)) {
    return { membership, isReporter };
  }

  throw httpError(
    403,
    "Only the task reporter or an organization admin can delete this task",
  );
}
