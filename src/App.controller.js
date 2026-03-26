import authController from "./modules/auth/auth.controller.js";
import userController from "./modules/user/user.controller.js";
import organizationController from "./modules/organization/organization.controller.js";
import taskController from "./modules/task/task.controller.js";
import sprintStatusController from "./modules/sprint/sprint.status.controller.js";
import meController from "./modules/me/me.controller.js";
import starController from "./modules/star/star.controller.js";
import commentController from "./modules/comment/comment.controller.js";
import projectController from "./modules/project/project.controller.js";
import teamController from "./modules/team/team.controller.js";
import notificationController from "./modules/notification/notification.controller.js";
import spaceController from "./modules/space/space.controller.js";

// ── Chat System ───────────────────────────────────────────────
import chatRoomController from "./modules/chatroom/chat.room.controller.js";
import messageController from "./modules/message/message.controller.js";
import reactionController from "./modules/reaction/reaction.controller.js";

import connectDB from "./DB/connection.js";
import { globalErrorHandling } from "./utils/response/error.response.js";
import cors from "cors";
import path from "node:path";
import rateLimit from "express-rate-limit";
import helmet from "helmet";

// ── Rate Limiters ─────────────────────────────────────────────
const generalLimiter = rateLimit({
  limit: 200,
  windowMs: 2 * 60 * 1000,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: "draft-8",
  legacyHeaders: true,
  statusCode: 429,
  handler: (req, res, next) => {
    return next(new Error("Too many requests", { cause: 429 }));
  },
});

const authLimiter = rateLimit({
  limit: 50,
  windowMs: 15 * 60 * 1000,
  message: "Too many authentication attempts, please try again later.",
});

// ── Bootstrap ─────────────────────────────────────────────────
export const bootstrap = async (app, express) => {
  // ── Security & Middleware ────────────────────────────────────
  app.use(cors());
  app.use(helmet());
  app.use("/auth", authLimiter);
  app.use(generalLimiter);
  app.use(express.json());
  app.use("/uploads", express.static(path.resolve("./src/uploads")));

  // ── Existing Routes ──────────────────────────────────────────
  app.use("/auth", authController);

  //   app.use("/org/:orgId/spaces", spaceController);
  app.use("/auth", authController);
  app.use("/user", userController);
  app.use("/org", organizationController);
  app.use("/task", taskController);
  app.use("/sprints", sprintStatusController);
  app.use("/me", meController);
  app.use("/stars", starController);
  app.use("/tasks/:taskId/comments", commentController);
  app.use("/notifications", notificationController);
  app.use("/org/:orgId/projects", projectController);
  app.use("/teams", teamController);
  app.use("/org/:orgId/spaces", spaceController);

  // ── Chat Routes ───────────────────────────────────────────────
  // ChatRooms   → /chat/rooms
  app.use("/chat/rooms", chatRoomController);

  // Messages    → /chat/rooms/:roomId/messages
  // mergeParams: true is set inside message.controller.js
  app.use("/chat/rooms/:roomId/messages", messageController);

  // Reactions   → /chat/rooms/:roomId/messages/:messageId/reactions
  // mergeParams: true is set inside reaction.controller.js
  app.use(
    "/chat/rooms/:roomId/messages/:messageId/reactions",
    reactionController,
  );

  // ── 404 Handler ───────────────────────────────────────────────
  app.all("*", (req, res, next) => {
    res.status(404).json({ success: false, message: "Page not found" });
  });

  // ── Global Error Handler ──────────────────────────────────────
  app.use(globalErrorHandling);

  // ── Database ─────────────────────────────────────────────────
  connectDB();
};

export default bootstrap;
