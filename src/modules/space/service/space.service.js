import Space from "../../../DB/Model/space.model.js";
import SpaceView, { viewTypes } from "../../../DB/Model/spaceView.model.js";
import Task, { taskPriority, taskStatus, taskTypes } from "../../../DB/Model/task.model.js";
import userModel from "../../../DB/Model/user.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { requireOrgMember } from "../../../utils/permissions/org.permissions.js";
import { httpError } from "../../../utils/errors/index.js";

const DEFAULT_VIEWS = [
  { type: viewTypes.Summary, name: "Summary" },
  { type: viewTypes.Timeline, name: "Timeline" },
  { type: viewTypes.Backlog, name: "Backlog" },
  { type: viewTypes.Sprints, name: "Active Sprints" },
  { type: viewTypes.Calendar, name: "Calendar" },
];

export const createSpace = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { name, icon = "", type } = req.body;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.create({
    model: Space,
    data: {
      name,
      icon,
      type,
      organizationId: orgId,
      createdBy: req.user._id,
      isDeleted: false,
    },
  });

  // Auto-create bundle of default views
  await SpaceView.insertMany(
    DEFAULT_VIEWS.map((v) => ({
      spaceId: space._id,
      organizationId: orgId,
      name: v.name,
      type: v.type,
      isDefault: true,
      config: {},
      isDeleted: false,
    }))
  );

  return successResponse(
    { res, message: "Space created", data: space },
    201
  );
});

export const listSpaces = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { type, q, page = 1, limit = 20 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const filter = { organizationId: orgId, isDeleted: false };
  if (type) filter.type = type;
  if (q) filter.name = { $regex: q, $options: "i" };

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Space.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Space.countDocuments(filter),
  ]);

  return successResponse(
    { res, data: { items, total, page: Number(page), limit: Number(limit) } },
    200
  );
});

// GET /org/:orgId/spaces/:spaceId — single space detail
export const getSpace = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));
  return successResponse({ res, data: space });
});

// PATCH /org/:orgId/spaces/:spaceId — rename / change icon / change type
//   The FE needs this for "edit space" UI. Without it the only way to
//   rename was delete + recreate, which would orphan all the tasks.
export const updateSpace = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { name, icon, type } = req.body;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  if (name !== undefined) space.name = name;
  if (icon !== undefined) space.icon = icon;
  // `type` is enum-validated by the schema — invalid values throw.
  if (type !== undefined) space.type = type;
  await space.save();

  return successResponse({ res, message: "Space updated", data: space });
});

// DELETE /org/:orgId/spaces/:spaceId — soft delete
//   Tasks/sprints under this space are NOT cascade-deleted (they keep
//   isDeleted=false). Callers should run a cleanup job if they want
//   them gone. This matches Jira: archiving a project keeps the issues.
export const deleteSpace = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  space.isDeleted = true;
  await space.save();
  return successResponse({ res, message: "Space deleted" });
});

export const searchSpaces = asyncHandler(async (req, res, next) => {
  const { orgId } = req.params;
  const { q, limit = 20 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const items = await Space.find({
    organizationId: orgId,
    isDeleted: false,
    $text: { $search: q },
  })
    .limit(Number(limit))
    .select("name icon type organizationId createdAt");

  return successResponse({ res, data: { items } }, 200);
});

export const getSpaceViews = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  const items = await SpaceView.find({
    organizationId: orgId,
    spaceId,
    isDeleted: false,
  }).sort({ createdAt: 1 });

  return successResponse({ res, data: { items } }, 200);
});

export const statusSummary = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  const rows = await Task.aggregate([
    {
      $match: {
        organizationId: space.organizationId,
        spaceId: space._id,
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const byStatus = {
    [taskStatus.Todo]: 0,
    [taskStatus.InProgress]: 0,
    [taskStatus.Done]: 0,
  };

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(byStatus, row._id)) {
      byStatus[row._id] = row.count;
    }
  }

  const total =
    byStatus[taskStatus.Todo] +
    byStatus[taskStatus.InProgress] +
    byStatus[taskStatus.Done];

  const percentages =
    total === 0
      ? {
          [taskStatus.Todo]: 0,
          [taskStatus.InProgress]: 0,
          [taskStatus.Done]: 0,
        }
      : {
          [taskStatus.Todo]: Number(((byStatus[taskStatus.Todo] / total) * 100).toFixed(2)),
          [taskStatus.InProgress]: Number(
            ((byStatus[taskStatus.InProgress] / total) * 100).toFixed(2)
          ),
          [taskStatus.Done]: Number(((byStatus[taskStatus.Done] / total) * 100).toFixed(2)),
        };

  return successResponse(
    {
      res,
      data: {
        organizationId: orgId,
        spaceId,
        totalTasks: total,
        byStatus,
        percentages,
      },
    },
    200
  );
});

export const prioritySummary = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  const rows = await Task.aggregate([
    {
      $match: {
        organizationId: space.organizationId,
        spaceId: space._id,
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: "$priority",
        count: { $sum: 1 },
      },
    },
  ]);

  const byPriority = {
    [taskPriority.Low]: 0,
    [taskPriority.Medium]: 0,
    [taskPriority.High]: 0,
    [taskPriority.Urgent]: 0,
  };

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(byPriority, row._id)) {
      byPriority[row._id] = row.count;
    }
  }

  const total =
    byPriority[taskPriority.Low] +
    byPriority[taskPriority.Medium] +
    byPriority[taskPriority.High] +
    byPriority[taskPriority.Urgent];

  const percentages =
    total === 0
      ? {
          [taskPriority.Low]: 0,
          [taskPriority.Medium]: 0,
          [taskPriority.High]: 0,
          [taskPriority.Urgent]: 0,
        }
      : {
          [taskPriority.Low]: Number(((byPriority[taskPriority.Low] / total) * 100).toFixed(2)),
          [taskPriority.Medium]: Number(
            ((byPriority[taskPriority.Medium] / total) * 100).toFixed(2)
          ),
          [taskPriority.High]: Number(((byPriority[taskPriority.High] / total) * 100).toFixed(2)),
          [taskPriority.Urgent]: Number(
            ((byPriority[taskPriority.Urgent] / total) * 100).toFixed(2)
          ),
        };

  return successResponse(
    {
      res,
      data: {
        organizationId: orgId,
        spaceId,
        totalTasks: total,
        byPriority,
        percentages,
      },
    },
    200
  );
});

export const workloadSummary = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  const rows = await Task.aggregate([
    {
      $match: {
        organizationId: space.organizationId,
        spaceId: space._id,
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: "$assigneeId",
        tasks: { $sum: 1 },
        points: { $sum: { $ifNull: ["$points", 0] } },
      },
    },
  ]);

  const assigneeIds = rows.filter((r) => r._id).map((r) => r._id);
  const users = await userModel
    .find({ _id: { $in: assigneeIds } })
    .select("_id username email")
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const totalTasks = rows.reduce((sum, r) => sum + r.tasks, 0);
  const totalPoints = rows.reduce((sum, r) => sum + r.points, 0);

  const distribution = rows
    .map((r) => {
      const user = r._id ? userMap.get(String(r._id)) : null;
      return {
        assigneeId: r._id || null,
        assigneeName: user?.username || "Unassigned",
        assigneeEmail: user?.email || null,
        tasks: r.tasks,
        points: r.points,
        taskPercent:
          totalTasks === 0 ? 0 : Number(((r.tasks / totalTasks) * 100).toFixed(2)),
        pointsPercent:
          totalPoints === 0 ? 0 : Number(((r.points / totalPoints) * 100).toFixed(2)),
      };
    })
    .sort((a, b) => b.tasks - a.tasks);

  return successResponse(
    {
      res,
      data: {
        organizationId: orgId,
        spaceId,
        totalTasks,
        totalPoints,
        distribution,
      },
    },
    200
  );
});

export const workTypeSummary = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  const rows = await Task.aggregate([
    {
      $match: {
        organizationId: space.organizationId,
        spaceId: space._id,
        isDeleted: false,
      },
    },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
      },
    },
  ]);

  const byType = {
    [taskTypes.Task]: 0,
    [taskTypes.Bug]: 0,
    [taskTypes.Story]: 0,
    [taskTypes.Epic]: 0,
  };

  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(byType, row._id)) {
      byType[row._id] = row.count;
    }
  }

  const totalTasks =
    byType[taskTypes.Task] +
    byType[taskTypes.Bug] +
    byType[taskTypes.Story] +
    byType[taskTypes.Epic];

  const percentages =
    totalTasks === 0
      ? {
          [taskTypes.Task]: 0,
          [taskTypes.Bug]: 0,
          [taskTypes.Story]: 0,
          [taskTypes.Epic]: 0,
        }
      : {
          [taskTypes.Task]: Number(((byType[taskTypes.Task] / totalTasks) * 100).toFixed(2)),
          [taskTypes.Bug]: Number(((byType[taskTypes.Bug] / totalTasks) * 100).toFixed(2)),
          [taskTypes.Story]: Number(((byType[taskTypes.Story] / totalTasks) * 100).toFixed(2)),
          [taskTypes.Epic]: Number(((byType[taskTypes.Epic] / totalTasks) * 100).toFixed(2)),
        };

  return successResponse(
    {
      res,
      data: {
        organizationId: orgId,
        spaceId,
        totalTasks,
        byType,
        percentages,
      },
    },
    200
  );
});

export const epicProgressSummary = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  const epics = await Task.find({
    organizationId: space.organizationId,
    spaceId: space._id,
    type: taskTypes.Epic,
    isDeleted: false,
  })
    .select("_id title status priority assigneeId createdAt updatedAt")
    .lean();

  if (!epics.length) {
    return successResponse(
      {
        res,
        data: {
          organizationId: orgId,
          spaceId,
          totalEpics: 0,
          items: [],
        },
      },
      200
    );
  }

  const epicIds = epics.map((e) => e._id);

  const childRows = await Task.aggregate([
    {
      $match: {
        organizationId: space.organizationId,
        spaceId: space._id,
        isDeleted: false,
        parentTaskId: { $in: epicIds },
      },
    },
    {
      $group: {
        _id: "$parentTaskId",
        totalChildren: { $sum: 1 },
        doneChildren: {
          $sum: {
            $cond: [{ $eq: ["$status", taskStatus.Done] }, 1, 0],
          },
        },
      },
    },
  ]);

  const childMap = new Map(
    childRows.map((r) => [String(r._id), { totalChildren: r.totalChildren, doneChildren: r.doneChildren }])
  );

  const items = epics.map((epic) => {
    const children = childMap.get(String(epic._id)) || { totalChildren: 0, doneChildren: 0 };
    const progressPercent =
      children.totalChildren === 0
        ? epic.status === taskStatus.Done
          ? 100
          : 0
        : Number(((children.doneChildren / children.totalChildren) * 100).toFixed(2));

    return {
      epicId: epic._id,
      title: epic.title,
      status: epic.status,
      priority: epic.priority,
      assigneeId: epic.assigneeId || null,
      totalChildren: children.totalChildren,
      doneChildren: children.doneChildren,
      remainingChildren: Math.max(children.totalChildren - children.doneChildren, 0),
      progressPercent,
      createdAt: epic.createdAt,
      updatedAt: epic.updatedAt,
    };
  });

  return successResponse(
    {
      res,
      data: {
        organizationId: orgId,
        spaceId,
        totalEpics: items.length,
        items,
      },
    },
    200
  );
});

export const timelineDataSummary = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const {
    from,
    to,
    status,
    priority,
    type,
    assigneeId,
    q,
    page = 1,
    limit = 20,
  } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  const filter = {
    organizationId: space.organizationId,
    spaceId: space._id,
    isDeleted: false,
  };

  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (type) filter.type = type;
  if (assigneeId) filter.assigneeId = assigneeId;
  if (q) filter.$text = { $search: q };

  if (from || to) {
    const fromDate = from ? new Date(from) : new Date("1970-01-01");
    const toDate = to ? new Date(to) : new Date("2999-12-31");
    filter.$or = [
      { startDate: { $gte: fromDate, $lte: toDate } },
      { dueDate: { $gte: fromDate, $lte: toDate } },
      { $and: [{ startDate: { $lte: fromDate } }, { dueDate: { $gte: toDate } }] },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Task.find(filter)
      .sort({ dueDate: 1, startDate: 1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("assigneeId", "username email")
      .select(
        "title type status priority assigneeId startDate dueDate points parentTaskId createdAt updatedAt"
      ),
    Task.countDocuments(filter),
  ]);

  return successResponse(
    {
      res,
      data: {
        organizationId: orgId,
        spaceId,
        filters: {
          from: from || null,
          to: to || null,
          status: status || null,
          priority: priority || null,
          type: type || null,
          assigneeId: assigneeId || null,
          q: q || null,
        },
        items,
        total,
        page: Number(page),
        limit: Number(limit),
      },
    },
    200
  );
});

export const backlogSummary = asyncHandler(async (req, res, next) => {
  const { orgId, spaceId } = req.params;
  const { status, priority, type, assigneeId, q, page = 1, limit = 20 } = req.query;

  await requireOrgMember(orgId, req.user._id);

  const space = await dbService.findOne({
    model: Space,
    filter: { _id: spaceId, organizationId: orgId, isDeleted: false },
  });
  if (!space) return next(httpError(404, "Space not found"));

  const filter = {
    organizationId: space.organizationId,
    spaceId: space._id,
    isDeleted: false,
    status: status || { $ne: taskStatus.Done },
  };

  if (priority) filter.priority = priority;
  if (type) filter.type = type;
  if (assigneeId) filter.assigneeId = assigneeId;
  if (q) filter.$text = { $search: q };

  const skip = (Number(page) - 1) * Number(limit);

  const [items, total] = await Promise.all([
    Task.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("assigneeId", "username email")
      .select(
        "title type status priority assigneeId startDate dueDate points parentTaskId createdAt updatedAt"
      ),
    Task.countDocuments(filter),
  ]);

  return successResponse(
    {
      res,
      data: {
        organizationId: orgId,
        spaceId,
        filters: {
          status: status || null,
          priority: priority || null,
          type: type || null,
          assigneeId: assigneeId || null,
          q: q || null,
        },
        items,
        total,
        page: Number(page),
        limit: Number(limit),
      },
    },
    200
  );
});
