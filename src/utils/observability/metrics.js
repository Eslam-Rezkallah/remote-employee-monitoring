/**
 * utils/observability/metrics.js
 *
 * Prometheus metrics endpoint. Optional — when `prom-client` isn't
 * installed we just no-op so the project keeps booting.
 *
 *   GET /metrics  →  Prometheus exposition format
 *
 * Tracked metrics (when enabled):
 *   • Default Node.js metrics (event loop lag, GC, heap, etc.)
 *   • http_requests_total{method,route,status}  — per route counter
 *   • http_request_duration_seconds{method,route,status} — histogram
 *
 * Route labels are normalized to the Express route pattern (not the raw
 * URL), so high-cardinality IDs (/users/507f...) don't blow up storage.
 */

import { childLogger } from "../logger/logger.js";

const log = childLogger("metrics");

let _client = null;
let _registry = null;
let _httpRequests = null;
let _httpDuration = null;
let _enabled = false;

/**
 * Boot-time wiring. Call once before mounting the middleware.
 * Returns true if metrics are actually enabled.
 */
export async function initMetrics() {
  try {
    _client = await import("prom-client");
  } catch (err) {
    // Surface the real failure reason — "not installed" was misleading
    // when the package was present but failed to load for other reasons.
    log.info(
      { err: err?.message },
      "prom-client unavailable — /metrics disabled",
    );
    return false;
  }

  _registry = new _client.Registry();
  _client.collectDefaultMetrics({ register: _registry });

  _httpRequests = new _client.Counter({
    name: "http_requests_total",
    help: "Count of HTTP requests by method, route and status",
    labelNames: ["method", "route", "status"],
    registers: [_registry],
  });

  _httpDuration = new _client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request latency in seconds",
    labelNames: ["method", "route", "status"],
    // Buckets tuned for typical CRUD APIs (5ms → 10s).
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [_registry],
  });

  _enabled = true;
  log.info("metrics initialised");
  return true;
}

/**
 * Express middleware that times each request. Mount it early in the
 * pipeline so it sees the response status of EVERY downstream handler.
 *
 * The `route` label uses `req.route.path` after Express has matched
 * the route — falls back to "unmatched" for 404s.
 */
export function metricsMiddleware() {
  return function metricsMiddlewareInner(req, res, next) {
    if (!_enabled) return next();
    const start = process.hrtime.bigint();

    res.on("finish", () => {
      const durSec =
        Number(process.hrtime.bigint() - start) / 1e9;
      // Use the matched route pattern, not the raw URL, to keep
      // cardinality bounded.
      const route =
        req.route?.path ||
        (req.baseUrl ? `${req.baseUrl}/*` : "unmatched");
      const labels = {
        method: req.method,
        route,
        status: String(res.statusCode),
      };
      try {
        _httpRequests.inc(labels);
        _httpDuration.observe(labels, durSec);
      } catch (err) {
        // Never let an instrumentation bug break the response
        log.warn({ err }, "metric observe failed");
      }
    });

    next();
  };
}

/** Mount the /metrics route. Safe to call even when disabled. */
export function mountMetricsRoute(app) {
  app.get("/metrics", async (req, res, next) => {
    if (!_enabled) return next();
    try {
      res.setHeader("Content-Type", _registry.contentType);
      res.end(await _registry.metrics());
    } catch (err) {
      next(err);
    }
  });
}
