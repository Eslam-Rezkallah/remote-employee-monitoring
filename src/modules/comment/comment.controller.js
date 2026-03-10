import { Router } from "express";
import * as commentService from "./service/comment.service.js";
import * as validators from "./comment.validation.js";
import { authentication } from "../../middleware/auth.middleware.js";
import { validation } from "../../middleware/validation.middleware.js";

// mergeParams: true → inherits :taskId from the parent route in App.controller.js
// Mount in App.controller.js as: app.use("/tasks/:taskId/comments", commentRouter)
const router = Router({ mergeParams: true });

// All comment routes require a logged-in user
router.use(authentication());

// ── CRUD ─────────────────────────────────────────────────────

// POST /tasks/:taskId/comments
router.post(
  "/",
  validation(validators.createComment),
  commentService.createComment,
);

// GET /tasks/:taskId/comments
router.get(
  "/",
  validation(validators.getTaskComments),
  commentService.getTaskComments,
);

// PATCH /tasks/:taskId/comments/:commentId
router.patch(
  "/:commentId",
  validation(validators.updateComment),
  commentService.updateComment,
);

// DELETE /tasks/:taskId/comments/:commentId
router.delete(
  "/:commentId",
  validation(validators.deleteComment),
  commentService.deleteComment,
);

export default router;