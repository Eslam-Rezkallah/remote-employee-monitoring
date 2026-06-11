import mongoose from "mongoose";
import Sprint from "../../../DB/Model/sprint.model.js";
import Task, { taskTypes } from "../../../DB/Model/task.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { cache, cacheKey } from "../../../utils/cache/lru.cache.js";
import {
  detectBottlenecksAI,
  predictSprintCompletionAI,
} from "../../../../ai-services/analytics.ai.service.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import { httpError } from "../../../utils/errors/index.js";

function getDateRange(query = {}) {
  const { from, to, days = 30 } = query;
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from
    ? new Date(from)
    : new Date(toDate.getTime() - Number(days) * 24 * 60 * 60 * 1000);

  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(23, 59, 59, 999);

  return { fromDate, toDate };
}

function average(nums = []) {
  if (!nums.length) return 0;
  return Number((nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(2));
}

function median(nums = []) {
  if (!nums.length) return 0;
  const sorted = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0)
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2));
  return Number(sorted[mid].toFixed(2));
}

function percentile(nums = [], p = 0.85) {
  if (!nums.length) return 0;
  const sorted = nums.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return Number(sorted[idx].toFixed(2));
}

function toHours(startDate, endDate) {
  return Math.max(
    (new Date(endDate).getTime() - new Date(startDate).getTime()) / 3600000,
    0,
  );
}

function deliveriesToHours(deliveries = []) {
  return deliveries.map((t) => toHours(t.createdAt, t.updatedAt));
}

async function fetchDoneTasksInRange({
  orgId,
  spaceId,
  fromDate,
  toDate,
  extra = {},
}) {
  return Task.find({
    organizationId: orgId,
    spaceId,
    isDeleted: false,
    status: "Done",
    updatedAt: { $gte: fromDate, $lte: toDate },
    ...extra,
  })
    .select(
      "title type labels createdAt startDate updatedAt assigneeId sprintId",
    )
    .lean();
}

export const velocity = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const last = Math.min(Math.max(parseInt(req.query.last || "5", 10), 1), 20);

  await requireOrgMember(orgId, req.user._id);

  const sprints = await Sprint.find({
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  })
    .sort({ endDate: -1 })
    .limit(last)
    .select("_id name startDate endDate status");

  if (!sprints.length) {
    return successResponse({
      res,
      data: { velocity: [], average: { tasks: 0, points: 0 }, meta: { last } },
    });
  }

  const sprintIds = sprints.map((s) => s._id);

  const rows = await Task.aggregate([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(orgId),
        spaceId: new mongoose.Types.ObjectId(spaceId),
        isDeleted: false,
        sprintId: { $in: sprintIds },
        status: "Done",
      },
    },
    {
      $group: {
        _id: "$sprintId",
        tasks: { $sum: 1 },
        points: { $sum: { $ifNull: ["$points", 0] } },
      },
    },
  ]);

  const map = new Map(
    rows.map((r) => [String(r._id), { tasks: r.tasks, points: r.points }]),
  );

  const velocityData = sprints
    .slice()
    .reverse()
    .map((s) => {
      const v = map.get(String(s._id)) || { tasks: 0, points: 0 };
      return {
        sprintId: s._id,
        sprint: s.name,
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status,
        completedTasks: v.tasks,
        completedPoints: v.points,
      };
    });

  const totalTasks = velocityData.reduce((sum, v) => sum + v.completedTasks, 0);
  const totalPoints = velocityData.reduce(
    (sum, v) => sum + v.completedPoints,
    0,
  );

  const avg = {
    tasks: Number((totalTasks / velocityData.length).toFixed(2)),
    points: Number((totalPoints / velocityData.length).toFixed(2)),
  };

  return successResponse({
    res,
    data: {
      velocity: velocityData,
      average: avg,
      meta: { last: velocityData.length },
    },
  });
});

export const cycleTime = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { sprintId, type, assigneeId, limit = 50 } = req.query;
  const { fromDate, toDate } = getDateRange(req.query);

  await requireOrgMember(orgId, req.user._id);

  const key = cacheKey([
    "cycleTime",
    orgId,
    spaceId,
    fromDate.toISOString(),
    toDate.toISOString(),
    sprintId || "",
    type || "",
    assigneeId || "",
    limit,
  ]);
  const cached = cache.get(key);
  if (cached) return successResponse({ res, data: cached });

  const filter = {
    organizationId: orgId,
    spaceId,
    isDeleted: false,
    status: "Done",
    updatedAt: { $gte: fromDate, $lte: toDate },
  };
  if (sprintId) filter.sprintId = sprintId;
  if (type) filter.type = type;
  if (assigneeId) filter.assigneeId = assigneeId;

  const tasks = await Task.find(filter)
    .select("title type assigneeId sprintId createdAt startDate updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  const rows = tasks.map((t) => {
    const start = t.startDate || t.createdAt;
    const cycleHours = toHours(start, t.updatedAt);
    return {
      taskId: t._id,
      title: t.title,
      type: t.type,
      assigneeId: t.assigneeId || null,
      sprintId: t.sprintId || null,
      startDate: start,
      doneAt: t.updatedAt,
      cycleTimeHours: Number(cycleHours.toFixed(2)),
      cycleTimeDays: Number((cycleHours / 24).toFixed(2)),
    };
  });

  const cycleHoursList = rows.map((r) => r.cycleTimeHours);
  const payload = {
    range: { from: fromDate, to: toDate },
    totalDoneTasks: rows.length,
    stats: {
      avgHours: average(cycleHoursList),
      medianHours: median(cycleHoursList),
      p85Hours: percentile(cycleHoursList, 0.85),
      avgDays: Number((average(cycleHoursList) / 24).toFixed(2)),
    },
    items: rows.slice(0, Number(limit)),
  };

  cache.set(key, payload);
  return successResponse({ res, data: payload });
});

export const deploymentFrequency = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { fromDate, toDate } = getDateRange(req.query);

  await requireOrgMember(orgId, req.user._id);

  const key = cacheKey([
    "deploymentFrequency",
    orgId,
    spaceId,
    fromDate.toISOString(),
    toDate.toISOString(),
  ]);
  const cached = cache.get(key);
  if (cached) return successResponse({ res, data: cached });

  const doneDeployments = await fetchDoneTasksInRange({
    orgId,
    spaceId,
    fromDate,
    toDate,
    extra: { type: { $in: [taskTypes.Task, taskTypes.Story] } },
  });

  const totalDays = Math.max(
    Math.ceil((toDate.getTime() - fromDate.getTime()) / 86400000),
    1,
  );
  const bucketByWeek = totalDays > 45;

  const buckets = {};
  for (const t of doneDeployments) {
    const d = new Date(t.updatedAt);
    let keyDate = d.toISOString().slice(0, 10);
    if (bucketByWeek) {
      const day = d.getUTCDay() || 7;
      const weekStart = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      );
      weekStart.setUTCDate(weekStart.getUTCDate() - (day - 1));
      keyDate = weekStart.toISOString().slice(0, 10);
    }
    buckets[keyDate] = (buckets[keyDate] || 0) + 1;
  }

  const series = Object.entries(buckets)
    .sort(([a], [b]) => (a > b ? 1 : -1))
    .map(([date, deployments]) => ({ date, deployments }));

  const avgPerDay = Number((doneDeployments.length / totalDays).toFixed(2));

  const payload = {
    range: { from: fromDate, to: toDate },
    bucket: bucketByWeek ? "week" : "day",
    totalDeployments: doneDeployments.length,
    avgDeploymentsPerDay: avgPerDay,
    avgDeploymentsPerWeek: Number((avgPerDay * 7).toFixed(2)),
    series,
    note: "Deployment frequency is estimated from Done Task/Story items.",
  };

  cache.set(key, payload);
  return successResponse({ res, data: payload });
});

export const changeFailureRate = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { fromDate, toDate } = getDateRange(req.query);

  await requireOrgMember(orgId, req.user._id);

  const key = cacheKey([
    "changeFailureRate",
    orgId,
    spaceId,
    fromDate.toISOString(),
    toDate.toISOString(),
  ]);
  const cached = cache.get(key);
  if (cached) return successResponse({ res, data: cached });

  const deployments = await fetchDoneTasksInRange({
    orgId,
    spaceId,
    fromDate,
    toDate,
    extra: { type: { $in: [taskTypes.Task, taskTypes.Story] } },
  });

  const failures = await fetchDoneTasksInRange({
    orgId,
    spaceId,
    fromDate,
    toDate,
    extra: { type: taskTypes.Bug },
  });

  const rate = deployments.length
    ? Number(((failures.length / deployments.length) * 100).toFixed(2))
    : 0;

  const payload = {
    range: { from: fromDate, to: toDate },
    deployments: deployments.length,
    failedChanges: failures.length,
    changeFailureRatePercent: rate,
    note: "Change failure rate is estimated from Done Bug items over Done Task/Story items.",
  };

  cache.set(key, payload);
  return successResponse({ res, data: payload });
});

export const mttr = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { fromDate, toDate } = getDateRange(req.query);

  await requireOrgMember(orgId, req.user._id);

  const key = cacheKey([
    "mttr",
    orgId,
    spaceId,
    fromDate.toISOString(),
    toDate.toISOString(),
  ]);
  const cached = cache.get(key);
  if (cached) return successResponse({ res, data: cached });

  const incidents = await fetchDoneTasksInRange({
    orgId,
    spaceId,
    fromDate,
    toDate,
    extra: { type: taskTypes.Bug },
  });

  const hours = incidents.map((t) => toHours(t.createdAt, t.updatedAt));
  const payload = {
    range: { from: fromDate, to: toDate },
    incidentsResolved: incidents.length,
    mttrHours: average(hours),
    mttrDays: Number((average(hours) / 24).toFixed(2)),
    medianHours: median(hours),
    p85Hours: percentile(hours, 0.85),
    note: "MTTR is estimated from Done Bug createdAt -> updatedAt duration.",
  };

  cache.set(key, payload);
  return successResponse({ res, data: payload });
});

export const leadTime = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { fromDate, toDate } = getDateRange(req.query);

  await requireOrgMember(orgId, req.user._id);

  const key = cacheKey([
    "leadTime",
    orgId,
    spaceId,
    fromDate.toISOString(),
    toDate.toISOString(),
  ]);
  const cached = cache.get(key);
  if (cached) return successResponse({ res, data: cached });

  const deliveries = await fetchDoneTasksInRange({
    orgId,
    spaceId,
    fromDate,
    toDate,
    extra: { type: { $in: [taskTypes.Task, taskTypes.Story] } },
  });

  const hours = deliveries.map((t) => toHours(t.createdAt, t.updatedAt));
  const payload = {
    range: { from: fromDate, to: toDate },
    completedDeliveries: deliveries.length,
    leadTimeHours: average(hours),
    leadTimeDays: Number((average(hours) / 24).toFixed(2)),
    medianHours: median(hours),
    p85Hours: percentile(hours, 0.85),
    note: "Lead time is estimated from Done Task/Story createdAt -> updatedAt duration.",
  };

  cache.set(key, payload);
  return successResponse({ res, data: payload });
});

// ✅ FIX: devopsSummary — removed duplicate query, reuse failures as incidents
export const devopsSummary = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { fromDate, toDate } = getDateRange(req.query);

  await requireOrgMember(orgId, req.user._id);

  const key = cacheKey([
    "devopsSummary",
    orgId,
    spaceId,
    fromDate.toISOString(),
    toDate.toISOString(),
  ]);
  const cached = cache.get(key);
  if (cached) return successResponse({ res, data: cached });

  // ✅ FIX: Only 2 queries instead of 3 (bugs = failures = incidents in this proxy model)
  const [deployments, bugs] = await Promise.all([
    fetchDoneTasksInRange({
      orgId,
      spaceId,
      fromDate,
      toDate,
      extra: { type: { $in: [taskTypes.Task, taskTypes.Story] } },
    }),
    fetchDoneTasksInRange({
      orgId,
      spaceId,
      fromDate,
      toDate,
      extra: { type: taskTypes.Bug },
    }),
  ]);

  const days = Math.max(
    Math.ceil((toDate.getTime() - fromDate.getTime()) / 86400000),
    1,
  );
  const deploymentFreqPerDay = Number((deployments.length / days).toFixed(2));

  const leadHours = deliveriesToHours(deployments);
  const mttrHoursList = bugs.map((t) => toHours(t.createdAt, t.updatedAt));

  const payload = {
    range: { from: fromDate, to: toDate },
    deploymentFrequency: {
      total: deployments.length,
      perDay: deploymentFreqPerDay,
      perWeek: Number((deploymentFreqPerDay * 7).toFixed(2)),
    },
    changeFailureRatePercent: deployments.length
      ? Number(((bugs.length / deployments.length) * 100).toFixed(2))
      : 0,
    leadTime: {
      avgHours: average(leadHours),
      avgDays: Number((average(leadHours) / 24).toFixed(2)),
    },
    mttr: {
      avgHours: average(mttrHoursList),
      avgDays: Number((average(mttrHoursList) / 24).toFixed(2)),
    },
    note: "DevOps metrics are estimated from task workflow data.",
  };

  cache.set(key, payload);
  return successResponse({ res, data: payload });
});

// AI-8.1
export const predictSprintCompletion = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { sprintId } = req.query;

  if (!sprintId) return next(httpError(400, "sprintId is required"));

  await requireOrgMember(orgId, req.user._id);

  const key = cacheKey(["aiSprintCompletion", orgId, spaceId, sprintId]);
  const cached = cache.get(key);
  if (cached) return successResponse({ res, data: cached });

  const sprint = await Sprint.findOne({
    _id: sprintId,
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  }).lean();

  if (!sprint) return next(httpError(404, "Sprint not found"));

  const tasks = await Task.find({
    organizationId: orgId,
    spaceId,
    sprintId,
    isDeleted: false,
  })
    .select(
      "_id title status points type priority assigneeId createdAt updatedAt dueDate",
    )
    .lean();

  const historySprints = await Sprint.find({
    organizationId: orgId,
    spaceId,
    isDeleted: false,
    _id: { $ne: sprint._id },
    endDate: { $lt: sprint.startDate },
  })
    .sort({ endDate: -1 })
    .limit(8)
    .select("_id name startDate endDate status")
    .lean();

  const historyIds = historySprints.map((s) => s._id);
  const rows = historyIds.length
    ? await Task.aggregate([
        {
          $match: {
            organizationId: new mongoose.Types.ObjectId(orgId),
            spaceId: new mongoose.Types.ObjectId(spaceId),
            isDeleted: false,
            sprintId: { $in: historyIds },
            status: "Done",
          },
        },
        {
          $group: {
            _id: "$sprintId",
            completedTasks: { $sum: 1 },
            completedPoints: { $sum: { $ifNull: ["$points", 0] } },
          },
        },
      ])
    : [];

  const bySprint = new Map(
    rows.map((r) => [
      String(r._id),
      { completedTasks: r.completedTasks, completedPoints: r.completedPoints },
    ]),
  );
  const history = historySprints.map((s) => {
    const r = bySprint.get(String(s._id)) || {
      completedTasks: 0,
      completedPoints: 0,
    };
    return {
      sprintId: s._id,
      sprint: s.name,
      ...r,
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status,
    };
  });

  const ai = await predictSprintCompletionAI({
    sprint,
    tasks,
    history,
    asOf: new Date().toISOString(),
  });

  const payload = {
    sprint: {
      id: sprint._id,
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    },
    ...ai,
  };

  cache.set(key, payload);
  return successResponse({ res, data: payload });
});

// AI-8.2
export const detectBottlenecks = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { sprintId } = req.query;
  const { fromDate, toDate } = getDateRange(req.query);

  await requireOrgMember(orgId, req.user._id);

  const key = cacheKey([
    "aiBottlenecks",
    orgId,
    spaceId,
    sprintId || "",
    fromDate.toISOString(),
    toDate.toISOString(),
  ]);
  const cached = cache.get(key);
  if (cached) return successResponse({ res, data: cached });

  const filter = {
    organizationId: orgId,
    spaceId,
    isDeleted: false,
    createdAt: { $lte: toDate },
  };
  if (sprintId) filter.sprintId = sprintId;

  const tasks = await Task.find(filter)
    .select(
      "_id title type status priority assigneeId points dueDate createdAt updatedAt sprintId",
    )
    .limit(2500)
    .lean();

  const ai = await detectBottlenecksAI({
    tasks,
    asOf: new Date().toISOString(),
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    sprintId: sprintId || null,
  });

  const payload = {
    scope: {
      orgId,
      spaceId,
      sprintId: sprintId || null,
      from: fromDate,
      to: toDate,
    },
    ...ai,
  };

  cache.set(key, payload);
  return successResponse({ res, data: payload });
});
