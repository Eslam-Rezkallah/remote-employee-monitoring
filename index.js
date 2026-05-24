// index.js
import { config } from "./src/config/index.js";

import express from "express";
import bootstrap from "./src/App.controller.js";
import { runIo } from "./src/modules/socket/socket.controller.js";
import startOTPCleanerJob from "./src/utils/jobs/otp.cleaner.job.js";
import { stopIdleDetection } from "./src/utils/jobs/idle.detection.job.js";
import mongoose from "mongoose";

const app = express();

console.log(`[${config.app.mood}] starting ${config.app.name}...`);

await bootstrap(app, express);

const httpServer = app.listen(config.app.port, () => {
  console.log(`app listening on port ${config.app.port}`);
});

runIo(httpServer);
startOTPCleanerJob();

// ─── Graceful shutdown (Phase 2 will extend) ────────────────────
const shutdown = async (signal) => {
  console.log(`[shutdown] received ${signal}, closing gracefully...`);

  // Stop accepting new HTTP connections
  httpServer.close(() => console.log("[shutdown] http server closed"));

  // Stop cron jobs
  try {
    stopIdleDetection();
  } catch (e) {
    console.error("[shutdown] stopIdleDetection error:", e.message);
  }

  // Close DB
  try {
    await mongoose.connection.close(false);
    console.log("[shutdown] mongodb closed");
  } catch (e) {
    console.error("[shutdown] mongo close error:", e.message);
  }

  // Give in-flight requests up to 10s to finish
  setTimeout(() => {
    console.log("[shutdown] forcing exit");
    process.exit(0);
  }, 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  shutdown("uncaughtException");
});
