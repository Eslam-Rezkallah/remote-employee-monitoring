import { Router } from "express";
import joi from "joi";
import mongoose from "mongoose";
import workSessionModel from "../../DB/Model/worksession.model.js";
import activityEventModel from "../../DB/Model/activityEvent.model.js";
import taskModel from "../../DB/Model/task.model.js";
import memberModel from "../../DB/Model/member.model.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import { isValidObjectId } from "../../middleware/validation.middleware.js";
import { asyncHandler } from "../../utils/response/error.response.js";
import { successResponse } from "../../utils/response/success.response.js";
import { httpError } from "../../utils/errors/index.js";
import {
  requireOrgMember,
  requireOrgAdmin,
} from "../../utils/permissions/org.permissions.js";

const router = Router();
router.use(authentication());

const id = joi.string().custom(isValidObjectId).required();

const dateRange = joi.object({
  orgId: id,
  from: joi.date().iso().optional(),
  to: joi.date().iso().optional(),
});

// ─────────────────────────────────────────────────────────────
// Productivity scoring algorithm
// ─────────────────────────────────────────────────────────────
// Inputs: active seconds, idle seconds, tasks completed, mention/comment
// counts. We blend them into a 0–100 score so dashboards can show a
// single comparable number. Weights are deliberately conservative so a
// 100 is hard to hit — leaves headroom for future signals.
//
//   focus   = activeSec / (activeSec + idleSec)  → 0..1
//   tasks   = min(tasksDone / 5, 1)               → 0..1  (5/day = max)
//   chatter = min(messages / 30, 1)               → 0..1  (collab signal)
//
//   score   = round(100 * (0.5*focus + 0.3*tasks + 0.2*chatter))
function computeProductivityScore({
  activeSec = 0,
  idleSec = 0,
  tasksDone = 0,
  messagesSent = 0,
}) {
  const wall = activeSec + idleSec;
  const focus = wall > 0 ? activeSec / wall : 0;
  const tasks = Math.min(tasksDone / 5, 1);
  const chatter = Math.min(messagesSent / 30, 1);
  return Math.round(100 * (0.5 * focus + 0.3 * tasks + 0.2 * chatter));
}

// GET /dashboards/me?orgId=&from=&to=
router.get(
  "/me",
  validation(dateRange.required()),
  asyncHandler(async (req, res) => {
    const { orgId, from, to } = req.query;
    await requireOrgMember(orgId, req.user._id);
    const fromD = from ? new Date(from) : new Date(Date.now() - 7 * 86400000);
    const toD = to ? new Date(to) : new Date();

    const sessions = await workSessionModel.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(orgId),
          userId: req.user._id,
          startTime: { $gte: fromD, $lte: toD },
        },
      },
      {
        $group: {
          _id: null,
          activeSec: { $sum: { $ifNull: ["$activeSeconds", 0] } },
          idleSec: { $sum: { $ifNull: ["$idleSeconds", 0] } },
          pausedSec: { $sum: { $ifNull: ["$pausedSeconds", 0] } },
          sessionCount: { $sum: 1 },
        },
      },
    ]);

    const tasksDone = await taskModel.countDocuments({
      organizationId: orgId,
      assigneeId: req.user._id,
      status: "Done",
      updatedAt: { $gte: fromD, $lte: toD },
      isDeleted: false,
    });

    const s = sessions[0] || { activeSec: 0, idleSec: 0 };
    const score = computeProductivityScore({
      activeSec: s.activeSec,
      idleSec: s.idleSec,
      tasksDone,
      messagesSent: 0, // wire if you want chat to count
    });

    return successResponse({
      res,
      data: {
        range: { from: fromD, to: toD },
        focusSeconds: s.activeSec,
        idleSeconds: s.idleSec,
        tasksDone,
        productivityScore: score,
      },
    });
  }),
);

// GET /dashboards/org/:orgId?from=&to=
// Admin-only — team productivity matrix.
router.get(
  "/org/:orgId",
  asyncHandler(async (req, res) => {
    const { orgId } = req.params;
    await requireOrgAdmin(orgId, req.user._id);

    const fromD = req.query.from
      ? new Date(req.query.from)
      : new Date(Date.now() - 7 * 86400000);
    const toD = req.query.to ? new Date(req.query.to) : new Date();

    // Active members
    const members = await memberModel
      .find({ organizationId: orgId, isActive: true })
      .select("userId role")
      .populate("userId", "username email image")
      .lean();

    // Sessions per user
    const sessionAgg = await workSessionModel.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(orgId),
          startTime: { $gte: fromD, $lte: toD },
        },
      },
      {
        $group: {
          _id: "$userId",
          activeSec: { $sum: { $ifNull: ["$activeSeconds", 0] } },
          idleSec: { $sum: { $ifNull: ["$idleSeconds", 0] } },
          sessions: { $sum: 1 },
        },
      },
    ]);
    const byUser = new Map(
      sessionAgg.map((r) => [String(r._id), r]),
    );

    // Tasks done per user
    const taskAgg = await taskModel.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(orgId),
          status: "Done",
          updatedAt: { $gte: fromD, $lte: toD },
          isDeleted: false,
        },
      },
      { $group: { _id: "$assigneeId", count: { $sum: 1 } } },
    ]);
    const tasksByUser = new Map(
      taskAgg.map((r) => [String(r._id), r.count]),
    );

    const rows = members
      .filter((m) => m.userId) // populate may yield null on deleted users
      .map((m) => {
        const uid = String(m.userId._id);
        const s = byUser.get(uid) || { activeSec: 0, idleSec: 0, sessions: 0 };
        const tasksDone = tasksByUser.get(uid) || 0;
        const score = computeProductivityScore({
          activeSec: s.activeSec,
          idleSec: s.idleSec,
          tasksDone,
        });
        return {
          user: m.userId,
          role: m.role,
          activeSeconds: s.activeSec,
          idleSeconds: s.idleSec,
          tasksDone,
          sessions: s.sessions,
          productivityScore: score,
        };
      })
      .sort((a, b) => b.productivityScore - a.productivityScore);

    const summary = {
      members: rows.length,
      avgScore:
        rows.length > 0
          ? Math.round(
              rows.reduce((a, r) => a + r.productivityScore, 0) / rows.length,
            )
          : 0,
      totalActiveHours:
        Math.round(
          (rows.reduce((a, r) => a + r.activeSeconds, 0) / 3600) * 10,
        ) / 10,
      totalTasksDone: rows.reduce((a, r) => a + r.tasksDone, 0),
    };

    return successResponse({
      res,
      data: {
        range: { from: fromD, to: toD },
        summary,
        rows,
      },
    });
  }),
);

// GET /dashboards/team/:teamId?from=&to=
// Same shape but scoped to a team. Resolves the team's org first then
// filters the rows to team members.
const teamModel = (await import("../../DB/Model/team.model.js")).default;

router.get(
  "/team/:teamId",
  asyncHandler(async (req, res) => {
    const { teamId } = req.params;
    const team = await teamModel.findById(teamId).select("organizationId members").lean();
    if (!team) throw httpError(404, "Team not found");
    await requireOrgAdmin(team.organizationId, req.user._id);

    const fromD = req.query.from
      ? new Date(req.query.from)
      : new Date(Date.now() - 7 * 86400000);
    const toD = req.query.to ? new Date(req.query.to) : new Date();

    const teamMemberIds = (team.members || []).map((m) => String(m));
    const memberSet = new Set(teamMemberIds);

    const sessionAgg = await workSessionModel.aggregate([
      {
        $match: {
          organizationId: new mongoose.Types.ObjectId(team.organizationId),
          userId: {
            $in: teamMemberIds.map((s) => new mongoose.Types.ObjectId(s)),
          },
          startTime: { $gte: fromD, $lte: toD },
        },
      },
      {
        $group: {
          _id: "$userId",
          activeSec: { $sum: { $ifNull: ["$activeSeconds", 0] } },
          idleSec: { $sum: { $ifNull: ["$idleSeconds", 0] } },
        },
      },
    ]);

    const userModel = (await import("../../DB/Model/user.model.js")).default;
    const users = await userModel
      .find({ _id: { $in: teamMemberIds } })
      .select("username email image")
      .lean();
    const usersById = new Map(users.map((u) => [String(u._id), u]));

    const rows = sessionAgg
      .filter((r) => memberSet.has(String(r._id)))
      .map((r) => {
        const score = computeProductivityScore({
          activeSec: r.activeSec,
          idleSec: r.idleSec,
        });
        return {
          user: usersById.get(String(r._id)),
          activeSeconds: r.activeSec,
          idleSeconds: r.idleSec,
          productivityScore: score,
        };
      })
      .sort((a, b) => b.productivityScore - a.productivityScore);

    return successResponse({
      res,
      data: { teamId, range: { from: fromD, to: toD }, rows },
    });
  }),
);

export default router;
