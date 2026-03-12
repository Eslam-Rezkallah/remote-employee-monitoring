import { Router } from "express";
import * as notificationService from "./service/notification.service.js";
import * as validators from "./notification.validation.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";

const router = Router();

// All routes require a logged-in user
router.use(authentication());

// ── GET /notifications ────────────────────────────────────────
// List notifications — optional ?isRead=false&page=1&limit=20
router.get(
  "/",
  validation(validators.listNotifications),
  notificationService.listNotifications,
);

// ── GET /notifications/unread-count ───────────────────────────
// Returns { count: N } — powers the bell badge
// Must be defined BEFORE /:notificationId to avoid conflict
router.get("/unread-count", notificationService.getUnreadCount);

// ── PATCH /notifications/read-all ────────────────────────────
// Mark ALL notifications as read — Jira "Mark all as read"
router.patch("/read-all", notificationService.markAllAsRead);

// ── PATCH /notifications/:notificationId/read ─────────────────
// Mark a single notification as read
router.patch(
  "/:notificationId/read",
  validation(validators.notificationId),
  notificationService.markAsRead,
);

// ── DELETE /notifications/:notificationId ─────────────────────
// Soft-delete a single notification
router.delete(
  "/:notificationId",
  validation(validators.notificationId),
  notificationService.deleteNotification,
);

// ── DELETE /notifications ─────────────────────────────────────
// Clear ALL notifications for the logged-in user
router.delete("/", notificationService.clearAllNotifications);

export default router;