import { Router } from "express";
import joi from "joi";
import meetingModel, {
  meetingStatus,
} from "../../DB/Model/meeting.model.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";
import {
  isValidObjectId,
  generalFields,
} from "../../middleware/validation.middleware.js";
import { asyncHandler } from "../../utils/response/error.response.js";
import { successResponse } from "../../utils/response/success.response.js";
import { httpError } from "../../utils/errors/index.js";
import { requireOrgMember } from "../../utils/permissions/org.permissions.js";
import { notificationEvent } from "../../utils/events/notification.event.js";

const router = Router();
router.use(authentication());

const id = joi.string().custom(isValidObjectId).required();

const createMeeting = joi
  .object({
    organizationId: id,
    chatRoomId: joi.string().custom(isValidObjectId).optional(),
    title: joi.string().trim().min(1).max(200).required(),
    agenda: joi.string().max(5000).allow(""),
    startTime: joi.date().iso().greater("now").required(),
    endTime: joi.date().iso().greater(joi.ref("startTime")).required(),
    recurrenceRule: joi.string().max(200).allow(null, ""),
    invitees: joi
      .array()
      .items(
        joi.object({
          userId: id,
          isRequired: joi.boolean().default(true),
        }),
      )
      .default([]),
  })
  .required();

const respondInvitation = joi
  .object({
    meetingId: id,
    status: joi
      .string()
      .valid("accepted", "declined", "tentative")
      .required(),
  })
  .required();

// POST /meetings
router.post(
  "/",
  validation(createMeeting),
  asyncHandler(async (req, res) => {
    const { organizationId, invitees, ...rest } = req.body;
    await requireOrgMember(organizationId, req.user._id);

    // De-dup invitees + ensure organizer is implicitly accepted.
    const inviteeMap = new Map();
    for (const inv of invitees || []) {
      inviteeMap.set(String(inv.userId), {
        userId: inv.userId,
        isRequired: inv.isRequired ?? true,
        status: "pending",
      });
    }
    inviteeMap.set(String(req.user._id), {
      userId: req.user._id,
      isRequired: true,
      status: "accepted",
      respondedAt: new Date(),
    });

    const meeting = await meetingModel.create({
      ...rest,
      organizationId,
      organizerId: req.user._id,
      invitees: [...inviteeMap.values()],
    });

    // Notify every invitee (except the organizer) once.
    for (const inv of meeting.invitees) {
      if (String(inv.userId) === String(req.user._id)) continue;
      notificationEvent.emit("meeting_invited", {
        recipientId: String(inv.userId),
        triggeredById: req.user._id,
        meetingId: meeting._id,
        title: meeting.title,
        startTime: meeting.startTime,
      });
    }

    return successResponse({ res, status: 201, data: meeting });
  }),
);

// GET /meetings?orgId=&from=&to=
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { orgId, from, to } = req.query;
    const filter = { isDeleted: false };
    if (orgId) {
      await requireOrgMember(orgId, req.user._id);
      filter.organizationId = orgId;
    } else {
      // No org filter → "my meetings" across every org I'm in.
      filter["invitees.userId"] = req.user._id;
    }
    if (from || to) {
      filter.startTime = {};
      if (from) filter.startTime.$gte = new Date(from);
      if (to) filter.startTime.$lte = new Date(to);
    }
    const items = await meetingModel
      .find(filter)
      .sort({ startTime: 1 })
      .limit(200)
      .populate("organizerId", "username email image")
      .lean();
    return successResponse({ res, data: { items } });
  }),
);

// PATCH /meetings/:meetingId/rsvp
router.patch(
  "/:meetingId/rsvp",
  validation(respondInvitation),
  asyncHandler(async (req, res) => {
    const meeting = await meetingModel.findOne({
      _id: req.params.meetingId,
      isDeleted: false,
    });
    if (!meeting) throw httpError(404, "Meeting not found");
    const inv = meeting.invitees.find(
      (i) => i.userId.toString() === req.user._id.toString(),
    );
    if (!inv) throw httpError(403, "You are not invited to this meeting");
    inv.status = req.body.status;
    inv.respondedAt = new Date();
    await meeting.save();
    return successResponse({ res, data: meeting });
  }),
);

// DELETE /meetings/:meetingId  — organizer cancels
router.delete(
  "/:meetingId",
  asyncHandler(async (req, res) => {
    const meeting = await meetingModel.findOne({
      _id: req.params.meetingId,
      isDeleted: false,
    });
    if (!meeting) throw httpError(404, "Meeting not found");
    if (meeting.organizerId.toString() !== req.user._id.toString()) {
      throw httpError(403, "Only the organizer can cancel a meeting");
    }
    meeting.status = meetingStatus.Cancelled;
    meeting.isDeleted = true;
    await meeting.save();

    // Notify invitees so their calendars update.
    for (const inv of meeting.invitees) {
      if (String(inv.userId) === String(req.user._id)) continue;
      notificationEvent.emit("meeting_cancelled", {
        recipientId: String(inv.userId),
        triggeredById: req.user._id,
        meetingId: meeting._id,
        title: meeting.title,
      });
    }
    return successResponse({ res, message: "Meeting cancelled" });
  }),
);

export default router;
