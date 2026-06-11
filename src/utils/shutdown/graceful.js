import mongoose from "mongoose";
import { closeRedis } from "../redis/client.js";
import { stopIdleDetection } from "../jobs/idle.detection.job.js";
import { logger } from "../logger/logger.js";

const log = logger.child({ module: "shutdown" });

let isShuttingDown = false;

/**
 * Drain order matters:
 *   1. Stop accepting new HTTP connections (httpServer.close)
 *   2. Stop Socket.IO accept loop
 *   3. Wait for in-flight requests (with timeout)
 *   4. Stop cron jobs (no new DB writes)
 *   5. Close Socket.IO
 *   6. Close Redis
 *   7. Close Mongo
 *   8. Flush logger
 */
export function attachGracefulShutdown({ httpServer, io }) {
  const shutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    log.info({ signal }, "shutdown initiated");

    // 1. Stop accepting new HTTP requests
    httpServer.close((err) => {
      if (err) log.error({ err }, "http close error");
      else log.info("http server closed");
    });

    // 2. Stop Socket.IO accept loop
    if (io) {
      // Refuse new connections immediately
      io.engine.close();
      log.info("socket.io engine closed");
    }

    // 3. Grace period for in-flight requests
    const drainMs = Number(process.env.SHUTDOWN_DRAIN_MS || 8000);
    await new Promise((r) => setTimeout(r, drainMs));

    // 4. Cron jobs
    try {
      stopIdleDetection();
      log.info("cron jobs stopped");
    } catch (err) {
      log.error({ err }, "stopIdleDetection error");
    }

    // 5. Close Socket.IO (disconnect remaining clients)
    if (io) {
      await new Promise((resolve) => io.close(() => resolve()));
      log.info("socket.io closed");
    }

    // 6. Close Redis
    try {
      await closeRedis();
      log.info("redis closed");
    } catch (err) {
      log.error({ err }, "redis close error");
    }

    // 7. Close Mongo
    try {
      await mongoose.connection.close(false);
      log.info("mongodb closed");
    } catch (err) {
      log.error({ err }, "mongo close error");
    }

    // 8. Flush logger and exit
    logger.flush?.();
    setTimeout(() => process.exit(0), 200).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Redis-related rejections are noisy when the server is unreachable
  // (ioredis queues commands and rejects them all when retries run out).
  // We treat them as expected during degraded operation: dropped silently.
  // Every other rejection still gets logged, with per-key dedup so a
  // single bug doesn't flood the log.
  const _rejectionSeenAt = new Map();
  const REJECTION_DEDUP_WINDOW_MS = 30_000;

  function isRedisNoise(reason) {
    if (!(reason instanceof Error)) return false;
    const msg = reason.message || "";
    const name = reason.name || "";
    return (
      name === "MaxRetriesPerRequestError" ||
      reason.code === "ECONNREFUSED" ||
      /unexpected reply from redis client/i.test(msg) ||
      /Connection is closed/i.test(msg)
    );
  }

  process.on("unhandledRejection", (reason) => {
    if (isRedisNoise(reason)) return; // expected when Redis is down

    const key = reason instanceof Error
      ? (reason.code || reason.name) + ":" + (reason.message || "")
      : String(reason);
    const now = Date.now();
    const lastSeen = _rejectionSeenAt.get(key) || 0;
    if (now - lastSeen < REJECTION_DEDUP_WINDOW_MS) return;
    _rejectionSeenAt.set(key, now);

    // pino's default `err` serializer extracts message/stack from Error
    // objects; the `reason` key would render `{}` because those props
    // are non-enumerable.
    if (reason instanceof Error) {
      log.error({ err: reason }, "unhandledRejection");
    } else {
      log.error(
        {
          reason:
            typeof reason === "object" ? JSON.stringify(reason) : String(reason),
        },
        "unhandledRejection",
      );
    }
  });

  process.on("uncaughtException", (err) => {
    log.fatal({ err }, "uncaughtException");
    shutdown("uncaughtException");
  });
}
