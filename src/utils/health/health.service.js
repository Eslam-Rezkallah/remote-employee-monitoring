import mongoose from "mongoose";
import { pingRedis } from "../redis/client.js";
import { config } from "../../config/index.js";

/**
 * /healthz → "am I alive?" — process is up, event loop responsive.
 *           Used by Docker/K8s liveness probe. Cheap.
 *
 * /readyz  → "can I serve traffic?" — DB + Redis (if enabled) are reachable.
 *           Used by readiness probe / load balancer.
 */

export async function liveness() {
  return {
    status: "ok",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    pid: process.pid,
    nodeVersion: process.version,
  };
}

export async function readiness() {
  const checks = {};

  // Mongo
  try {
    const state = mongoose.connection.readyState;
    // 1 = connected, 2 = connecting
    checks.mongo = {
      ok: state === 1,
      readyState: state,
    };
  } catch (err) {
    checks.mongo = { ok: false, error: err.message };
  }

  // Redis (only if enabled)
  if (config.redis.enabled) {
    checks.redis = await pingRedis();
  }

  const allOk = Object.values(checks).every((c) => c.ok);
  return { status: allOk ? "ok" : "degraded", checks };
}
