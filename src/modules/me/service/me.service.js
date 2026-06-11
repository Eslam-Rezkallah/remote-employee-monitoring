import Task from "../../../DB/Model/task.model.js";
import userModel from "../../../DB/Model/user.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { annotateWorkedOnWithAI, rerankForYouWithPythonAI } from "../../../../ai-services/me.ai.service.js";
import { requireOrgMember as _requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import { httpError } from "../../../utils/errors/index.js";

// OPTIONAL: if you have these models, you can uncomment and use them
// import Comment from "../../../DB/Model/comment.model.js";
// import WorkSession from "../../../DB/Model/worksession.model.js";

// Optional-orgId wrapper: this module exposes endpoints (e.g. assignedTasks)
// where orgId is optional in the query. The central requireOrgMember always
// requires both args — wrap it to preserve the existing "no-orgId = skip"
// behavior so callers don't need to add their own conditionals.
async function requireOrgMember(orgId, userId) {
  if (!orgId) return;
  return _requireOrgMember(orgId, userId);
}

function toBoolean(value, defaultValue = true) {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === "boolean") return value;
  return String(value).toLowerCase() !== "false";
}

function scoreCandidates(candidates, { userId, since, now }) {
  const priorityScore = (p) =>
    p === "Urgent" ? 40 : p === "High" ? 30 : p === "Medium" ? 15 : 5;

  const statusScore = (s) =>
    s === "InProgress" ? 15 : s === "Todo" ? 10 : s === "Done" ? -50 : 0;

  const dueSoonScore = (dueDate) => {
    if (!dueDate) return 0;
    const d = new Date(dueDate).getTime();
    const diffDays = Math.ceil((d - now) / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return 35;
    if (diffDays <= 1) return 30;
    if (diffDays <= 3) return 20;
    if (diffDays <= 7) return 10;
    return 0;
  };

  const staleScore = (updatedAt) => {
    const u = new Date(updatedAt).getTime();
    const diffDays = Math.ceil((now - u) / (24 * 60 * 60 * 1000));
    if (diffDays >= 14) return 10;
    if (diffDays >= 7) return 5;
    return 0;
  };

  const workedOnBoost = (task) => {
    const u = new Date(task.updatedAt).getTime();
    return u >= since.getTime() ? 8 : 0;
  };

  return candidates
    .map((t) => {
      const score =
        priorityScore(t.priority) +
        statusScore(t.status) +
        dueSoonScore(t.dueDate) +
        staleScore(t.updatedAt) +
        workedOnBoost(t);

      const reasons = [];
      if (t.dueDate) reasons.push("due-date");
      if (t.priority) reasons.push(`priority:${t.priority}`);
      if (t.status) reasons.push(`status:${t.status}`);
      if (new Date(t.updatedAt) >= since) reasons.push("recently-updated");
      if (t.assigneeId?.toString?.() === userId.toString?.()) reasons.push("assigned-to-you");

      return { task: t, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * BE-6.2 Assigned tasks
 * GET /me/tasks/assigned?orgId=&spaceId=&status=&from=&to=&page=&limit=
 */
export const assignedTasks = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, status, priority, from, to, page = 1, limit = 20 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const filter = {
    isDeleted: false,
    assigneeId: req.user._id,
  };
  if (orgId) filter.organizationId = orgId;
  if (spaceId) filter.spaceId = spaceId;
  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  // dueDate filter
  if (from || to) {
    filter.dueDate = {};
    if (from) filter.dueDate.$gte = new Date(from);
    if (to) filter.dueDate.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Task.find(filter).sort({ dueDate: 1, createdAt: -1 }).skip(skip).limit(Number(limit)),
    Task.countDocuments(filter),
  ]);

  return successResponse(
    { res, data: { items, total, page: Number(page), limit: Number(limit) } },
    200
  );
});

/**
 * BE-6.1 Worked-on tasks (lightweight version)
 * We treat "worked on" as:
 * - tasks assigned to you OR reported by you
 * - AND updated recently (updatedAt within last N days)
 *
 * Later (Phase 7), you'll use Activity logs for a perfect definition.
 *
 * GET /me/tasks/worked-on?orgId=&spaceId=&days=&limit=
 */
export const workedOnTasks = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, days = 14, limit = 30, useAI = true } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);

  const filter = { isDeleted: false, updatedAt: { $gte: since } };
  if (orgId) filter.organizationId = orgId;
  if (spaceId) filter.spaceId = spaceId;

  filter.$or = [
    { assigneeId: req.user._id },
    { reporterId: req.user._id },
  ];

  const items = await Task.find(filter)
    .sort({ updatedAt: -1 })
    .limit(Number(limit));

  const aiRequested = toBoolean(useAI, true);
  const ai = aiRequested
    ? await annotateWorkedOnWithAI({ items })
    : {
      aiUsed: false,
      aiModel: null,
      aiFallbackReason: "AI disabled by query",
      notesById: new Map(),
    };

  const enrichedItems = items.map((t) => {
    const aiData = ai.notesById.get(String(t._id)) || {};
    return {
      ...t.toObject(),
      aiScore: aiData.aiScore ?? null,
      aiNote: aiData.aiNote ?? null,
    };
  });

  return successResponse({
    res,
    data: {
      items: enrichedItems,
      since,
      meta: {
        aiRequested,
        aiUsed: ai.aiUsed,
        aiModel: ai.aiModel,
        aiFallbackReason: ai.aiFallbackReason,
      },
    },
  }, 200);
});

/**
 * BE-6.3 Team tasks
 * GET /me/tasks/team?orgId=&spaceId=&teamId=&status=&priority=&from=&to=&includeSelf=&page=&limit=
 */
export const teamTasks = asyncHandler(async (req, res, next) => {
  const {
    orgId,
    spaceId,
    teamId,
    status,
    priority,
    from,
    to,
    includeSelf = false,
    page = 1,
    limit = 20,
  } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const myTeamIds = (req.user.teams || []).map((id) => id.toString());
  if (teamId && !myTeamIds.includes(String(teamId))) {
    throw httpError(403, "You are not part of this team");
  }

  const selectedTeamIds = teamId ? [String(teamId)] : myTeamIds;
  if (!selectedTeamIds.length) {
    return successResponse({
      res,
      data: {
        items: [],
        total: 0,
        page: Number(page),
        limit: Number(limit),
        teamIds: [],
        teammateCount: 0,
      },
    });
  }

  const teammateFilter = {
    isDeleted: false,
    isActive: true,
    teams: { $in: selectedTeamIds },
  };

  if (!toBoolean(includeSelf, false)) {
    teammateFilter._id = { $ne: req.user._id };
  }

  const teammates = await userModel
    .find(teammateFilter)
    .select("_id username email teams")
    .lean();

  const teammateIds = teammates.map((u) => u._id);
  if (!teammateIds.length) {
    return successResponse({
      res,
      data: {
        items: [],
        total: 0,
        page: Number(page),
        limit: Number(limit),
        teamIds: selectedTeamIds,
        teammateCount: 0,
      },
    });
  }

  const filter = {
    isDeleted: false,
    assigneeId: { $in: teammateIds },
  };

  if (orgId) filter.organizationId = orgId;
  if (spaceId) filter.spaceId = spaceId;
  if (status) filter.status = status;
  if (priority) filter.priority = priority;

  if (from || to) {
    filter.dueDate = {};
    if (from) filter.dueDate.$gte = new Date(from);
    if (to) filter.dueDate.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Task.find(filter)
      .sort({ dueDate: 1, updatedAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("assigneeId", "username email")
      .populate("reporterId", "username email"),
    Task.countDocuments(filter),
  ]);

  return successResponse({
    res,
    data: {
      items,
      total,
      page: Number(page),
      limit: Number(limit),
      teamIds: selectedTeamIds,
      teammateCount: teammateIds.length,
    },
  });
});

/**
 * BE-6.4 For You (AI + rule-based ranking)
 *
 * Uses:
 * - due soon
 * - priority
 * - status (Todo/InProgress favored)
 * - stale tasks penalty/boost
 * - "worked on" boost (recently updated by you)
 * GET /me/for-you?orgId=&spaceId=&days=&limit=&useAI=
 */
export const forYou = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId, days = 14, limit = 15, useAI = true } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const now = Date.now();
  const since = new Date(now - Number(days) * 24 * 60 * 60 * 1000);

  // Candidate pool: assigned to you OR recently worked-on
  const baseFilter = { isDeleted: false };
  if (orgId) baseFilter.organizationId = orgId;
  if (spaceId) baseFilter.spaceId = spaceId;

  const candidates = await Task.find({
    ...baseFilter,
    $or: [
      { assigneeId: req.user._id },
      { reporterId: req.user._id, updatedAt: { $gte: since } },
      { assigneeId: req.user._id, updatedAt: { $gte: since } },
    ],
  }).limit(500);

  const scored = scoreCandidates(candidates, {
    userId: req.user._id,
    since,
    now,
  });

  const historySince = new Date(now - 90 * 24 * 60 * 60 * 1000);

  const historyFilter = { isDeleted: false, updatedAt: { $gte: historySince } };
  if (orgId) historyFilter.organizationId = orgId;
  if (spaceId) historyFilter.spaceId = spaceId;

  const userHistory = await Task.find({
    ...historyFilter,
    $or: [{ assigneeId: req.user._id }, { reporterId: req.user._id }],
  })
    .select(
      "_id title type status priority labels dueDate spaceId assigneeId reporterId parentTaskId createdAt updatedAt"
    )
    .limit(800)
    .lean();

  const myTeamIds = (req.user.teams || []).map((id) => id.toString());
  let teamHistory = [];
  if (myTeamIds.length) {
    const teammateIds = await userModel
      .find({
        isDeleted: false,
        isActive: true,
        teams: { $in: myTeamIds },
        _id: { $ne: req.user._id },
      })
      .select("_id")
      .lean();

    const assigneeIds = teammateIds.map((x) => x._id);
    if (assigneeIds.length) {
      teamHistory = await Task.find({
        ...historyFilter,
        assigneeId: { $in: assigneeIds },
      })
        .select(
          "_id title type status priority labels dueDate spaceId assigneeId reporterId parentTaskId createdAt updatedAt"
        )
        .limit(1200)
        .lean();
    }
  }

  const aiRequested = toBoolean(useAI, true);
  const ai = aiRequested
    ? await rerankForYouWithPythonAI({
      scored,
      limit: Number(limit),
      userHistory,
      teamHistory,
    })
    : {
      aiUsed: false,
      aiModel: null,
      aiFallbackReason: "AI disabled by query",
      items: scored.slice(0, Number(limit)),
    };

  return successResponse(
    {
      res,
      data: {
        items: ai.items,
        meta: {
          since,
          limit: Number(limit),
          aiRequested,
          aiUsed: ai.aiUsed,
          aiModel: ai.aiModel,
          aiFallbackReason: ai.aiFallbackReason,
        },
      },
    },
    200
  );
});
