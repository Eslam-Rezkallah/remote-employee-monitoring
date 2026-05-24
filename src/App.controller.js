// src/App.controller.js
import authController from "./modules/auth/auth.controller.js";
import userController from "./modules/user/user.controller.js";
import organizationController from "./modules/organization/organization.controller.js";
import sprintStatusController from "./modules/sprint/sprint.status.controller.js";
import meController from "./modules/me/me.controller.js";
import starController from "./modules/star/star.controller.js";
import commentController from "./modules/comment/comment.controller.js";
import projectController from "./modules/project/project.controller.js";
import teamController from "./modules/team/team.controller.js";
import notificationController from "./modules/notification/notification.controller.js";
import workSessionController from "./modules/workSession/workSession.controller.js";
import chatRoomController from "./modules/chatroom/chat.room.controller.js";
import messageController from "./modules/message/message.controller.js";
import reactionController from "./modules/reaction/reaction.controller.js";
import callController from "./modules/call/call.controller.js";
import inviteController from "./modules/invite/invite.controller.js";
import { config } from "./config/index.js";

import connectDB from "./DB/connection.js";
import { globalErrorHandling } from "./utils/response/error.response.js";
import {
  startIdleDetection,
  recoverOrphanedSessions,
} from "./utils/jobs/idle.detection.job.js";
import cors from "cors";
import path from "node:path";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { TooManyRequestsError } from "./utils/errors/index.js";

// ─── Rate Limiters ────────────────────────────────────────────
const generalLimiter = rateLimit({
  limit: 200,
  windowMs: 2 * 60 * 1000,
  standardHeaders: "draft-8",
  legacyHeaders: true,
  handler: (req, res, next) =>
    next(new TooManyRequestsError("Too many requests, please try again later")),
});

const authLimiter = rateLimit({
  limit: 50,
  windowMs: 15 * 60 * 1000,
  handler: (req, res, next) =>
    next(
      new TooManyRequestsError(
        "Too many authentication attempts, please try again later",
      ),
    ),
});

// ─── Bootstrap ────────────────────────────────────────────────
const bootstrap = async (app, express) => {
  // Request ID for tracing (Phase 2 will wire this to structured logger)
  app.use((req, res, next) => {
    req.id = req.headers["x-request-id"] || randomUUID();
    res.setHeader("x-request-id", req.id);
    next();
  });

  app.use(
    cors({
      origin: config.app.frontendUrl,
      credentials: true,
    }),
  );
  app.use(helmet());

  // Body size limit (basic DoS protection)
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.use("/auth", authLimiter);
  app.use(generalLimiter);
  app.use("/uploads", express.static(path.resolve("./src/uploads")));

  // ─── Health checks (Phase 2 will expand) ────────────────────
  app.get("/healthz", (req, res) =>
    res.status(200).json({
      success: true,
      message: "OK",
      data: { uptime: process.uptime(), timestamp: new Date().toISOString() },
    }),
  );

  // ─── Routes ─────────────────────────────────────────────────
  app.use("/auth", authController);
  app.use("/user", userController);
  app.use("/org", organizationController);
  app.use("/org/:orgId/projects", projectController);
  app.use("/sprints", sprintStatusController);
  app.use("/me", meController);
  app.use("/stars", starController);
  app.use("/tasks/:taskId/comments", commentController);
  app.use("/notifications", notificationController);
  app.use("/teams", teamController);
  app.use("/work-session", workSessionController);
  app.use("/invite", inviteController);

  // ─── Chat ───────────────────────────────────────────────────
  app.use("/chat/rooms", chatRoomController);
  app.use("/chat/rooms/:roomId/messages", messageController);
  app.use(
    "/chat/rooms/:roomId/messages/:messageId/reactions",
    reactionController,
  );

  // ─── Calls ──────────────────────────────────────────────────
  app.use("/chat/rooms/:roomId/calls", callController);

  // ─── 404 ────────────────────────────────────────────────────
  app.all("*", (req, res) => {
    res.status(404).json({
      success: false,
      message: `Route ${req.method} ${req.originalUrl} not found`,
      data: null,
    });
  });

  // ─── Error Handler ──────────────────────────────────────────
  app.use(globalErrorHandling);

  // ─── DB + boot hooks ────────────────────────────────────────
  await connectDB();
  await recoverOrphanedSessions();
  startIdleDetection();
};

export default bootstrap;
