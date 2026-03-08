import authController from "./modules/auth/auth.controller.js";
import userController from "./modules/user/user.controller.js";
import organizationController from "./modules/organization/organization.controller.js";
import taskController from "./modules/task/task.controller.js";
import sprintStatusController from "./modules/sprint/sprint.status.controller.js";
import meController from "./modules/me/me.controller.js";
import starController from "./modules/star/star.controller.js";
import chatController from "./modules/chatroom/chatroom.controller.js";
import connectDB from "./DB/connection.js";
import { globalErrorHandling } from "./utils/response/error.response.js";
import cors from "cors";
import path from "node:path";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
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
  windowMs: 15 * 60 * 1000, // 15 minutes
  message: "Too many authentication attempts, please try again later.",
});

const postLimiter = rateLimit({
  limit: 100,
  windowMs: 2 * 60 * 1000,
});
export const bootstrap = async (app, express) => {

  app.use("/post", postLimiter);
  app.use("/auth", authLimiter);
  app.use(cors()); // cors options can be added
  app.use(helmet());
  app.use(generalLimiter);

  app.use("/uploads", express.static(path.resolve("./src/uploads")));
  app.use(express.json());
  app.use("/auth", authController);
  app.use("/user", userController);
  app.use("/org", organizationController);
  //app.use("/task", taskController);
  app.use("/sprints", sprintStatusController);
  app.use("/me", meController);
  app.use("/stars", starController);
  app.use("/api/chat", chatController);

  app.all("*", (req, res, next) => {
    res.status(404).json({ success: false, message: "page not found" });
  });
  app.use(globalErrorHandling);
  connectDB();
};

export default bootstrap;
