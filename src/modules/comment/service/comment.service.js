import { asyncHandler } from "../../../utils/response/error.response.js";
import { successResponse } from "../../../utils/response/success.response.js";
import * as dbService from "../../../DB/db.service.js";
import commentModel from "../../../DB/Model/comment.model.js";
import taskModel from "../../../DB/Model/task.model.js";
import { roleTypes } from "../../../DB/Model/user.model.js";
import { notificationEvent } from "../../../utils/events/notification.event.js";
import { httpError } from "../../../utils/errors/index.js";

// ── Shared populate config ────────────────────────────────────
const commentPopulate = [
  { path: "createdBy", select: "username email image" },
  { path: "mentions", select: "username email" },
  {
    path: "parentComment",
    select: "content createdBy createdAt",
    populate: { path: "createdBy", select: "username" },
  },
];

// ── CREATE ────────────────────────────────────────────────────
export const createComment = asyncHandler(async (req, res, next) => {
  const { taskId } = req.params;
  const { content, parentComment, mentions = [] } = req.body;

  // Verify task exists
  const task = await dbService.findOne({
    model: taskModel,
    filter: { _id: taskId },
  });

  if (!task) {
    return next(httpError(404, "Task not found"));
  }

  // If reply — verify parent exists and belongs to same task
  if (parentComment) {
    const parent = await dbService.findOne({
      model: commentModel,
      filter: { _id: parentComment, task: taskId },
    });

    if (!parent) {
      return next(
        httpError(404, "Parent comment not found or does not belong to this task"),
      );
    }

    // Notify the parent comment author about the reply (in-app only)
    if (parent.createdBy.toString() !== req.user._id.toString()) {
      notificationEvent.emit("comment_reply", {
        recipientId: parent.createdBy,
        triggeredById: req.user._id,
        replierName: req.user.username,
        commentContent: content,
        taskId,
      });
    }
  }

  // Create the comment
  const comment = await dbService.create({
    model: commentModel,
    data: {
      content,
      task: taskId,
      createdBy: req.user._id,
      parentComment: parentComment || null,
      mentions,
    },
  });

  // Populate for response
  const populated = await dbService.findOne({
    model: commentModel,
    filter: { _id: comment._id },
    populate: commentPopulate,
  });

  // ── In-App Notifications only ─────────────────────────────

  // 1. Notify task assignee when someone comments on their task
  if (
    !parentComment &&
    task.assigneeId &&
    task.assigneeId.toString() !== req.user._id.toString()
  ) {
    notificationEvent.emit("comment_added", {
      watcherIds: [task.assigneeId],
      triggeredById: req.user._id,
      commenterName: req.user.username,
      taskTitle: task.title,
      taskId,
      commentContent: content,
    });
  }

  // 2. Notify mentioned users (in-app only)
  if (mentions.length > 0) {
    notificationEvent.emit("comment_mention", {
      mentionedUserIds: mentions,
      triggeredById: req.user._id,
      commenterName: req.user.username,
      taskTitle: task.title,
      taskId,
      commentContent: content,
    });
  }

  return successResponse({
    res,
    status: 201,
    data: { comment: populated },
    message: parentComment ? "Reply added" : "Comment added",
  });
});

// ── LIST (threaded) ───────────────────────────────────────────
export const getTaskComments = asyncHandler(async (req, res, next) => {
  const { taskId } = req.params;
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const skip = (page - 1) * limit;

  const task = await dbService.findOne({
    model: taskModel,
    filter: { _id: taskId },
  });

  if (!task) {
    return next(httpError(404, "Task not found"));
  }


  const comments = await dbService.find({
    model: commentModel,
    filter: { task: taskId },
    populate: commentPopulate,
    skip,
    limit,
  });


  const total = comments.length;

  // ── Build threaded tree ───────────────────────────────────
  const map = new Map();
  const roots = [];

  comments.forEach((c) => {
    map.set(c._id.toString(), { ...c.toObject(), replies: [] });
  });

  comments.forEach((c) => {
    const doc = map.get(c._id.toString());

    if (c.parentComment) {
      const parentId =
        typeof c.parentComment === "object"
          ? c.parentComment._id.toString()
          : c.parentComment.toString();

      const parent = map.get(parentId);
      if (parent) {
        parent.replies.push(doc);
      } else {
        roots.push(doc);
      }
    } else {
      roots.push(doc);
    }
  });

  // Replies oldest → newest within each thread (JS sort — no DB sort needed)
  roots.forEach((root) => {
    root.replies.sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    );
  });

  // Newest top-level comments first
  roots.reverse();

  return successResponse({
    res,
    data: {
      comments: roots,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    },
  });
});

// ── UPDATE (author only) ──────────────────────────────────────
export const updateComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;
  const { content } = req.body;

  const comment = await dbService.findOne({
    model: commentModel,
    filter: { _id: commentId },
  });

  if (!comment) {
    return next(httpError(404, "Comment not found"));
  }

  if (comment.createdBy.toString() !== req.user._id.toString()) {
    return next(
      httpError(403, "Only the author can edit this comment"),
    );
  }

  const updated = await dbService.findOneAndUpdate({
    model: commentModel,
    filter: { _id: commentId },
    data: { content, isEdited: true, editedAt: new Date() },
    options: { new: true },
    populate: commentPopulate,
  });

  return successResponse({
    res,
    data: { comment: updated },
    message: "Comment updated",
  });
});

// ── DELETE (author or Admin, cascades to replies) ─────────────
export const deleteComment = asyncHandler(async (req, res, next) => {
  const { commentId } = req.params;

  const comment = await dbService.findOne({
    model: commentModel,
    filter: { _id: commentId },
  });

  if (!comment) {
    return next(httpError(404, "Comment not found"));
  }

  const isAuthor = comment.createdBy.toString() === req.user._id.toString();
  const isAdmin = req.user.role === roleTypes.Admin;

  if (!isAuthor && !isAdmin) {
    return next(
      httpError(403, "Not authorized to delete this comment"),
    );
  }

  await dbService.deleteOne({
    model: commentModel,
    filter: { _id: commentId },
  });

  await dbService.deleteMany({
    model: commentModel,
    filter: { parentComment: commentId },
  });

  return successResponse({ res, message: "Comment deleted successfully" });
});