/**
 * Task dependencies (Jira-style blocks / blockedBy).
 *
 * The graph is stored bidirectionally on the Task model (see
 * src/DB/Model/task.model.js). Service functions here ALWAYS update
 * both sides in lock-step so consumers can read either side without
 * a reverse query.
 *
 * Cycle guard:
 *   Adding "A blockedBy B" is rejected if B is already blocked
 *   (transitively) by A. The check is a BFS up the chain — O(N+E)
 *   where N is the number of tasks involved. Typical dependency
 *   chains in a sprint are tiny (< 50 tasks), so this is fine.
 */

import mongoose from "mongoose";
import Task from "../../../DB/Model/task.model.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { httpError } from "../../../utils/errors/index.js";
import {
  requireTaskEditAccess,
} from "../../../utils/permissions/task.permissions.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";

const ID = (v) => new mongoose.Types.ObjectId(String(v));

async function loadScopedTask({ orgId, spaceId, taskId }) {
  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    throw httpError(400, "Invalid taskId");
  }
  const task = await Task.findOne({
    _id: taskId,
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  });
  if (!task) throw httpError(404, "Task not found");
  return task;
}

/**
 * BFS upwards through the blockedBy graph starting from `startId`,
 * returning true if `targetId` is found in the chain (= cycle).
 *
 * Walks up to MAX_DEPTH levels to avoid runaway scans on corrupted
 * data; in practice no real chain reaches double digits.
 */
async function wouldCreateCycle(startId, targetId) {
  const MAX_DEPTH = 100;
  const visited = new Set([String(startId)]);
  let frontier = [startId];
  let depth = 0;

  while (frontier.length && depth++ < MAX_DEPTH) {
    const docs = await Task.find({
      _id: { $in: frontier },
      isDeleted: false,
    })
      .select("blockedBy")
      .lean();

    const next = [];
    for (const d of docs) {
      for (const b of d.blockedBy || []) {
        const s = String(b);
        if (s === String(targetId)) return true;
        if (!visited.has(s)) {
          visited.add(s);
          next.push(b);
        }
      }
    }
    frontier = next;
  }
  return false;
}

// POST /org/:orgId/spaces/:spaceId/tasks/:taskId/dependencies
// body: { blockerId: <taskId> }  — declares "this task is blocked by blockerId"
export const addDependency = asyncHandler(async (req, res) => {
  const { orgId, spaceId, taskId } = req.params;
  const { blockerId } = req.body;

  if (String(taskId) === String(blockerId)) {
    throw httpError(400, "A task cannot block itself");
  }

  const task = await loadScopedTask({ orgId, spaceId, taskId });
  await requireTaskEditAccess({ task, orgId, userId: req.user._id });

  // The blocker must exist in the same org (not necessarily the same
  // space — cross-space dependencies are valid in Jira).
  const blocker = await Task.findOne({
    _id: blockerId,
    organizationId: orgId,
    isDeleted: false,
  });
  if (!blocker) {
    throw httpError(404, "Blocker task not found in this organization");
  }

  // Cycle check: would adding "task blockedBy blocker" create a loop?
  // It does iff blocker is already (transitively) blocked by task.
  if (await wouldCreateCycle(blocker._id, task._id)) {
    throw httpError(409, "This dependency would create a cycle");
  }

  // Idempotent: $addToSet on both sides.
  await Promise.all([
    Task.updateOne(
      { _id: task._id },
      { $addToSet: { blockedBy: blocker._id } },
    ),
    Task.updateOne(
      { _id: blocker._id },
      { $addToSet: { blocks: task._id } },
    ),
  ]);

  const updated = await Task.findById(task._id)
    .populate("blockedBy", "title status priority")
    .populate("blocks", "title status priority");

  return successResponse({
    res,
    message: "Dependency added",
    data: updated,
  });
});

// DELETE /org/:orgId/spaces/:spaceId/tasks/:taskId/dependencies/:blockerId
export const removeDependency = asyncHandler(async (req, res) => {
  const { orgId, spaceId, taskId, blockerId } = req.params;

  const task = await loadScopedTask({ orgId, spaceId, taskId });
  await requireTaskEditAccess({ task, orgId, userId: req.user._id });

  if (!mongoose.Types.ObjectId.isValid(blockerId)) {
    throw httpError(400, "Invalid blockerId");
  }

  await Promise.all([
    Task.updateOne(
      { _id: task._id },
      { $pull: { blockedBy: ID(blockerId) } },
    ),
    Task.updateOne(
      { _id: blockerId },
      { $pull: { blocks: task._id } },
    ),
  ]);

  return successResponse({ res, message: "Dependency removed" });
});

// GET /org/:orgId/spaces/:spaceId/tasks/:taskId/dependencies
// Returns the populated blockers + blocked tasks for this task.
export const listDependencies = asyncHandler(async (req, res) => {
  const { orgId, spaceId, taskId } = req.params;
  await requireOrgMember(orgId, req.user._id);

  const task = await loadScopedTask({ orgId, spaceId, taskId });
  const populated = await Task.findById(task._id)
    .select("blockedBy blocks")
    .populate("blockedBy", "title status priority assigneeId")
    .populate("blocks", "title status priority assigneeId");

  return successResponse({
    res,
    data: {
      blockedBy: populated.blockedBy,
      blocks: populated.blocks,
    },
  });
});

// GET /org/:orgId/spaces/:spaceId/tasks/:taskId/children
// Lists subtasks (Epic > Story > Subtask tree). The parent task
// must exist and the user must be an org member.
export const listChildren = asyncHandler(async (req, res) => {
  const { orgId, spaceId, taskId } = req.params;
  await requireOrgMember(orgId, req.user._id);

  // Verify parent exists in scope (prevents enumeration of foreign tasks)
  await loadScopedTask({ orgId, spaceId, taskId });

  const children = await Task.find({
    parentTaskId: taskId,
    organizationId: orgId,
    isDeleted: false,
  })
    .select(
      "title type status priority assigneeId reporterId points dueDate updatedAt",
    )
    .populate("assigneeId", "username email image")
    .sort({ createdAt: 1 })
    .lean();

  return successResponse({
    res,
    data: { parentId: taskId, count: children.length, items: children },
  });
});
