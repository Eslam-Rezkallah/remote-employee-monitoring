import { Router } from "express";
import joi from "joi";
import activityEventModel, {
  activityEventTypes,
} from "../../DB/Model/activityEvent.model.js";
import workSessionModel from "../../DB/Model/worksession.model.js";
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
import { getIo } from "../socket/socket.controller.js";

const router = Router();
router.use(authentication());

const id = joi.string().custom(isValidObjectId).required();

const eventItem = joi.object({
  type: joi
    .string()
    .valid(...Object.values(activityEventTypes))
    .required(),
  bucketAt: joi.date().iso().required(),
  startTime: joi.date().iso().optional(),
  endTime: joi.date().iso().optional(),
  payload: joi.object().default({}),
  clientPlatform: joi.string().max(20).optional(),
  agentVersion: joi.string().max(40).optional(),
});

const batchUpload = joi
  .object({
    sessionId: id,
    events: joi.array().items(eventItem).min(1).max(500).required(),
  })
  .required();

// POST /work-session/:sessionId/activity-events
router.post(
  "/:sessionId/activity-events",
  validation(batchUpload),
  asyncHandler(async (req, res) => {
    const session = await workSessionModel
      .findById(req.params.sessionId)
      .select("userId organizationId status endTime")
      .lean();
    if (!session) throw httpError(404, "Work session not found");
    if (session.userId.toString() !== req.user._id.toString()) {
      throw httpError(403, "Only the session owner can upload events for it");
    }

    // Stamp each event with derived fields so the agent doesn't have
    // to know its own userId/orgId/sessionId.
    const docs = req.body.events.map((e) => ({
      ...e,
      bucketAt: new Date(e.bucketAt),
      startTime: e.startTime ? new Date(e.startTime) : null,
      endTime: e.endTime ? new Date(e.endTime) : null,
      userId: session.userId,
      organizationId: session.organizationId,
      sessionId: session._id,
    }));

    // `ordered: false` keeps the batch going even if one row violates
    // a constraint — we'd rather store 499/500 than reject the whole upload.
    const result = await activityEventModel.insertMany(docs, {
      ordered: false,
    });

    // Push a lightweight summary to the admin live-stream so manager
    // dashboards update in real time without polling.
    try {
      const io = getIo();
      if (io) {
        const counts = result.reduce((acc, d) => {
          acc[d.type] = (acc[d.type] || 0) + 1;
          return acc;
        }, {});
        io.of("/admin").to(`org:${session.organizationId}`).emit(
          "activity:batch",
          {
            userId: String(session.userId),
            sessionId: String(session._id),
            counts,
            at: new Date(),
          },
        );
      }
    } catch (_) {
      /* socket optional — never block uploads */
    }

    return successResponse({
      res,
      status: 201,
      data: { inserted: result.length },
    });
  }),
);

// GET /work-session/activity-events?userId=&from=&to=&type=
// Self can see own; org admins can query any user in their org.
router.get(
  "/activity-events",
  asyncHandler(async (req, res) => {
    const { userId, orgId, from, to, type } = req.query;
    if (!orgId) throw httpError(400, "orgId is required");
    if (userId && userId !== req.user._id.toString()) {
      await requireOrgAdmin(orgId, req.user._id);
    } else {
      await requireOrgMember(orgId, req.user._id);
    }

    const filter = {
      organizationId: orgId,
      userId: userId || req.user._id,
    };
    if (type) filter.type = type;
    if (from || to) {
      filter.bucketAt = {};
      if (from) filter.bucketAt.$gte = new Date(from);
      if (to) filter.bucketAt.$lte = new Date(to);
    }

    const items = await activityEventModel
      .find(filter)
      .sort({ bucketAt: -1 })
      .limit(1000)
      .lean();

    return successResponse({ res, data: { items } });
  }),
);

export default router;
