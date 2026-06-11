import pino from "pino";
import { config } from "../../config/index.js";

const isDev = config.app.isDev;

/**
 * Single Pino instance. NEVER use console.log/error outside this module.
 * Import the logger and use logger.info/warn/error.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  base: {
    service: config.app.name,
    env: config.app.mood,
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,

  // Redact sensitive fields anywhere they appear in log objects.
  // IMPORTANT: When you add a new secret-bearing field anywhere in the
  // codebase, add the path here BEFORE the first log call that could
  // include it.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.oldPassword",
      "req.body.confirmPassword",
      "req.body.idToken",
      "req.body.refreshToken",
      "req.body.code",
      "*.password",
      "*.token",
      "*.tokenHash",
      "*.refreshToken",
      "*.accessToken",
      "*.idToken",
      // LiveKit
      "*.apiSecret",
      "*.api_secret",
      "*.livekitSecret",
      "*.LIVEKIT_API_SECRET",
      // Generic credential-bearing keys
      "*.secret",
      "*.privateKey",
      "*.webhookSecret",
      // Explicit paths for nested config blocks. Pino's wildcard `*`
      // matches one level only — so `*.apiSecret` won't catch
      // `config.cloudinary.apiSecret` (three levels deep).
      "config.livekit.apiSecret",
      "config.cloudinary.apiSecret",
      "config.cloudinary.apiKey",
      "config.email.password",
      "config.oauth.googleClientId",
      "config.ai.openaiApiKey",
      "config.security.userAccessSecret",
      "config.security.userRefreshSecret",
      "config.security.adminAccessSecret",
      "config.security.adminRefreshSecret",
    ],
    censor: "[REDACTED]",
  },

  // Pretty print in dev, JSON in prod
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname,service,env",
          singleLine: false,
        },
      }
    : undefined,
});

/**
 * Create a child logger with extra bindings.
 * Use this in modules so every log line carries module context.
 *
 *   const log = childLogger("chat-socket");
 *   log.info({ userId }, "connected");
 */
export const childLogger = (moduleName, bindings = {}) =>
  logger.child({ module: moduleName, ...bindings });
