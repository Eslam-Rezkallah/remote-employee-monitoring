/**
 * modules/task/service/task.workflow.service.js
 *
 * Per-space task workflows (custom Kanban columns).
 *
 *   POST   /org/:orgId/spaces/:spaceId/workflow            create / replace
 *   GET    /org/:orgId/spaces/:spaceId/workflow            read
 *   DELETE /org/:orgId/spaces/:spaceId/workflow            revert to defaults
 *
 * Permission model: org owner/admin only — workflows shape every
 * task in the space and changing them mid-sprint is disruptive.
 *
 * Validation rules enforced at write time (Joi can't express them):
 *   1. ≥ 2 statuses
 *   2. exactly 1 isDefault status
 *   3. unique `key` values
 *   4. every status has a category
 *   5. `order` values dense and unique starting from 0
 */

import Space from "../../../DB/Model/space.model.js";
import taskWorkflowModel, {
  statusCategories,
} from "../../../DB/Model/taskWorkflow.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { httpError } from "../../../utils/errors/index.js";
import { requireOrgAdmin } from "../../../utils/permissions/org.permissions.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import * as dbService from "../../../DB/db.service.js";

function validateStatuses(statuses) {
  if (!Array.isArray(statuses) || statuses.length < 2) {
    throw httpError(400, "A workflow needs at least 2 statuses");
  }
  const keys = new Set();
  let defaultCount = 0;
  const allowedCats = new Set(Object.values(statusCategories));

  for (const s of statuses) {
    if (!s.key || !s.label) {
      throw httpError(400, "Every status needs key + label");
    }
    if (keys.has(s.key)) {
      throw httpError(400, `Duplicate status key: ${s.key}`);
    }
    keys.add(s.key);
    if (!allowedCats.has(s.category)) {
      throw httpError(
        400,
        `Invalid category "${s.category}". Allowed: ${[...allowedCats].join(", ")}`,
      );
    }
    if (s.isDefault) defaultCount++;
  }
  if (defaultCount !== 1) {
    throw httpError(
      400,
      `Workflow must have exactly 1 isDefault status, got ${defaultCount}`,
    );
  }
}

async function requireSpace(spaceId, orgId) {
  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) throw httpError(404, "Space not found");
  return space;
}

// POST /org/:orgId/spaces/:spaceId/workflow
// Idempotent upsert: passes the new status set as the canonical
// workflow. Existing tasks whose status disappeared from the set
// keep their value but won't be valid for new transitions until the
// workflow includes them again.
export const upsertWorkflow = asyncHandler(async (req, res) => {
  const { orgId, spaceId } = req.params;
  const { name, statuses } = req.body;

  await requireOrgAdmin(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  // Normalize `order` to be 0..N-1 in the array order the client
  // supplied. Saves the FE from sending stable positions.
  const normalized = statuses.map((s, i) => ({ ...s, order: i }));
  validateStatuses(normalized);

  const workflow = await taskWorkflowModel.findOneAndUpdate(
    { spaceId, organizationId: orgId },
    {
      $set: {
        name: name || "Default workflow",
        statuses: normalized,
        isDeleted: false,
      },
      $setOnInsert: { spaceId, organizationId: orgId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return successResponse({
    res,
    message: "Workflow saved",
    data: workflow,
  });
});

// GET /org/:orgId/spaces/:spaceId/workflow
// Returns the space's workflow OR the implicit default if none is set.
export const getWorkflow = asyncHandler(async (req, res) => {
  const { orgId, spaceId } = req.params;
  await requireOrgMember(orgId, req.user._id);
  await requireSpace(spaceId, orgId);

  const wf = await taskWorkflowModel.findOne({
    spaceId,
    organizationId: orgId,
    isDeleted: false,
  });

  if (wf) return successResponse({ res, data: wf });

  // No custom workflow — return the implicit default so the FE can
  // render the same shape regardless. `_id: null` is the signal
  // "this is the implicit default, not a stored document".
  return successResponse({
    res,
    data: {
      _id: null,
      spaceId,
      organizationId: orgId,
      name: "Default (built-in)",
      statuses: defaultStatusSet(),
      isImplicit: true,
    },
  });
});

// DELETE /org/:orgId/spaces/:spaceId/workflow
// Reverts the space to the implicit default. Soft-delete — keeps the
// row for audit, but the next read returns the built-in set.
export const deleteWorkflow = asyncHandler(async (req, res) => {
  const { orgId, spaceId } = req.params;
  await requireOrgAdmin(orgId, req.user._id);

  await taskWorkflowModel.updateOne(
    { spaceId, organizationId: orgId, isDeleted: false },
    { $set: { isDeleted: true } },
  );

  return successResponse({
    res,
    message: "Workflow reverted to defaults",
  });
});

/**
 * Helper for other services (task.service.changeStatus) to validate a
 * proposed status against the space's workflow. Falls back to the
 * built-in Todo/InProgress/Done enum when no workflow exists.
 *
 * Exported so it stays in one place — keep it in sync with the
 * default set below.
 */
/**
 * Resolution order (most specific wins):
 *   1. workflow with appliesTo === <task type>
 *   2. workflow with appliesTo === null (space default)
 *   3. hardcoded Todo/InProgress/Done enum
 *
 * Pass `taskType` so a Bug can be validated against its own workflow
 * even if the space has a different default for regular Tasks.
 */
export async function isValidStatusForSpace(spaceId, status, taskType = null) {
  const wfs = await taskWorkflowModel
    .find({
      spaceId,
      isDeleted: false,
      appliesTo: { $in: [taskType, null] },
    })
    .select("appliesTo statuses.key")
    .lean();

  if (wfs.length === 0) {
    return ["Todo", "InProgress", "Done"].includes(status);
  }

  // Prefer the type-specific workflow if both exist.
  const specific = wfs.find((w) => w.appliesTo === taskType);
  const wf = specific || wfs.find((w) => w.appliesTo === null);
  if (!wf) return ["Todo", "InProgress", "Done"].includes(status);

  return wf.statuses.some((s) => s.key === status);
}

function defaultStatusSet() {
  return [
    {
      key: "Todo",
      label: "To do",
      category: statusCategories.Todo,
      color: "gray.400",
      order: 0,
      isDefault: true,
    },
    {
      key: "InProgress",
      label: "In progress",
      category: statusCategories.InProgress,
      color: "blue.500",
      order: 1,
      isDefault: false,
    },
    {
      key: "Done",
      label: "Done",
      category: statusCategories.Done,
      color: "green.500",
      order: 2,
      isDefault: false,
    },
  ];
}
