import pinoHttp from "pino-http";
import { logger } from "./logger.js";

/**
 * Express middleware that:
 *  - Logs every request (method, url, status, latency)
 *  - Reuses the req.id set by App.controller (Phase 1) for tracing
 *  - Each request handler can access `req.log` (child logger with reqId bound)
 */
export const requestLogger = pinoHttp({
  logger,

  // Reuse the Phase 1 request ID
  genReqId: (req) => req.id,

  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    if (req.url === "/healthz" || req.url === "/readyz") return "trace";
    return "info";
  },

  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} → ${res.statusCode}`,

  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} → ${res.statusCode} : ${err.message}`,

  // Trim noisy fields
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
        userAgent: req.headers?.["user-agent"],
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});
