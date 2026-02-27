import mongoose from "mongoose";
import Sprint from "../../../DB/Model/sprint.model.js";
import Task from "../../../DB/Model/task.model.js";
import memberModel from "../../../DB/Model/member.model.js";
import * as dbService from "../../../DB/db.service.js";
import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import { cache, cacheKey } from "../../../utils/cache/lru.cache.js";

async function requireOrgMember(orgId, userId) {
  const member = await dbService.findOne({
    model: memberModel,
    filter: { organizationId: orgId, userId, isActive: true },
  });
  if (!member) throw new Error("Not a member of this organization", { cause: 403 });
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
    return successResponse(
      { res, data: { velocity: [], average: { tasks: 0, points: 0 }, meta: { last } } },
      200
    );
  }

  const sprintIds = sprints.map((s) => s._id);

  // Done tasks & points per sprint (aggregate)
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

  const map = new Map(rows.map((r) => [String(r._id), { tasks: r.tasks, points: r.points }]));

  const velocity = sprints
    .slice()
    .reverse() // return oldest->newest for charts
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

  const totalTasks = velocity.reduce((sum, v) => sum + v.completedTasks, 0);
  const totalPoints = velocity.reduce((sum, v) => sum + v.completedPoints, 0);

  const average = {
    tasks: Number((totalTasks / velocity.length).toFixed(2)),
    points: Number((totalPoints / velocity.length).toFixed(2)),
  };

  return successResponse(
    {
      res,
      data: {
        velocity,
        average,
        meta: { last: velocity.length },
      },
    },
    200
  );
});


