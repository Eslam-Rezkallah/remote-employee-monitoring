import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import * as dbService from "../../../DB/db.service.js";
import notificationModel from "../../../DB/Model/notification.model.js";
import { httpError } from "../../../utils/errors/index.js";

// ── Shared populate config ────────────────────────────────────
const notificationPopulate = [
  { path: "triggeredBy", select: "username image" },
];

// ── LIST ──────────────────────────────────────────────────────
export const listNotifications = asyncHandler(async (req, res, next) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const filter = {
    recipient: req.user._id,
    isDeleted: { $ne: true }, // ✅ matches false AND missing/undefined (old docs)
  };

  // ?isRead=false → unread only | ?isRead=true → read only | omit → all
  if (req.query.isRead !== undefined) {
    filter.isRead = req.query.isRead === "true";
  }

  // ✅ find instead of findAll, skip/limit as direct params
  const notifications = await dbService.find({
    model: notificationModel,
    filter,
    populate: notificationPopulate,
    skip,
    limit,
  });

  // ✅ length instead of countDocuments
  const total = notifications.length;

  return successResponse({
    res,
    data: {
      notifications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// ── UNREAD COUNT ──────────────────────────────────────────────
export const getUnreadCount = asyncHandler(async (req, res, next) => {
  // ✅ find + length instead of countDocuments
  // ✅ $ne: true instead of false (handles old docs without isDeleted field)
  const unread = await dbService.find({
    model: notificationModel,
    filter: {
      recipient: req.user._id,
      isRead: false,
      isDeleted: { $ne: true },
    },
  });

  const count = unread.length;

  return successResponse({ res, data: { count } });
});

// ── MARK ONE AS READ ──────────────────────────────────────────
export const markAsRead = asyncHandler(async (req, res, next) => {
  const { notificationId } = req.params;

  const notification = await dbService.findOne({
    model: notificationModel,
    filter: {
      _id: notificationId,
      recipient: req.user._id,
      isDeleted: { $ne: true }, // ✅
    },
  });

  if (!notification) {
    return next(httpError(404, "Notification not found"));
  }

  if (notification.isRead) {
    return next(
      httpError(400, "Notification is already marked as read"),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: notificationModel,
    filter: { _id: notificationId },
    data: { isRead: true, readAt: Date.now() },
    options: { new: true },
    populate: notificationPopulate,
  });

  return successResponse({
    res,
    message: "Notification marked as read",
    data: { notification: updated },
  });
});

// ── MARK ALL AS READ ──────────────────────────────────────────
export const markAllAsRead = asyncHandler(async (req, res, next) => {
  await dbService.updateMany({
    model: notificationModel,
    filter: {
      recipient: req.user._id,
      isRead: false,
      isDeleted: { $ne: true }, // ✅
    },
    data: {
      isRead: true,
      readAt: Date.now(),
    },
  });

  return successResponse({ res, message: "All notifications marked as read" });
});

// ── DELETE ONE ────────────────────────────────────────────────
export const deleteNotification = asyncHandler(async (req, res, next) => {
  const { notificationId } = req.params;

  const notification = await dbService.findOne({
    model: notificationModel,
    filter: {
      _id: notificationId,
      recipient: req.user._id,
      isDeleted: { $ne: true }, // ✅
    },
  });

  if (!notification) {
    return next(httpError(404, "Notification not found"));
  }

  await dbService.findOneAndUpdate({
    model: notificationModel,
    filter: { _id: notificationId },
    data: { isDeleted: true, deletedAt: Date.now() },
  });

  return successResponse({ res, message: "Notification deleted" });
});

// ── CLEAR ALL ─────────────────────────────────────────────────
export const clearAllNotifications = asyncHandler(async (req, res, next) => {
  await dbService.updateMany({
    model: notificationModel,
    filter: {
      recipient: req.user._id,
      isDeleted: { $ne: true }, // ✅
    },
    data: {
      isDeleted: true,
      deletedAt: Date.now(),
    },
  });

  return successResponse({ res, message: "All notifications cleared" });
});