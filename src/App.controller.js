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
import deviceController from "./modules/device/device.controller.js";
import reminderController from "./modules/reminder/reminder.controller.js";
import meetingController from "./modules/meeting/meeting.controller.js";
import channelTabController from "./modules/chatroom/channel-tab.controller.js";
import screenshotController from "./modules/workSession/screenshot.controller.js";
import activityEventController from "./modules/workSession/activity-event.controller.js";
import dashboardController from "./modules/dashboard/dashboard.controller.js";
import { config } from "./config/index.js";
import { generalLimiter, authLimiter } from "./utils/rate-limit/limiters.js";
import connectDB from "./DB/connection.js";
import { globalErrorHandling } from "./utils/response/error.response.js";
import {
  startIdleDetection,
  recoverOrphanedSessions,
} from "./utils/jobs/idle.detection.job.js";
import { liveness, readiness } from "./utils/health/health.service.js";
import { handleLivekitWebhook } from "./modules/call/service/call.service.js";
import {
  initMetrics,
  metricsMiddleware,
  mountMetricsRoute,
} from "./utils/observability/metrics.js";
import { openApiSpec, swaggerHtml } from "./utils/openapi/spec.js";
// Side-effect import: registers the built-in slash commands.
import "./modules/message/slash/built-ins.js";
import cors from "cors";
import path from "node:path";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { requestLogger } from "./utils/logger/request.logger.js";
import { logger } from "./utils/logger/logger.js";

// ─── Bootstrap ────────────────────────────────────────────────
const bootstrap = async (app, express) => {
  // Request ID for tracing — must run before requestLogger so pino-http
  // picks it up via genReqId.
  app.use((req, res, next) => {
    req.id = req.headers["x-request-id"] || randomUUID();
    res.setHeader("x-request-id", req.id);
    next();
  });
  app.use(requestLogger);

  // Prometheus metrics — no-op when prom-client isn't installed.
  // Mounted BEFORE other handlers so it sees every response status.
  await initMetrics();
  app.use(metricsMiddleware());
  mountMetricsRoute(app);

  // When the Angular SPA is served FROM this backend (single-origin deployment),
  // CORS is irrelevant for same-origin requests.  We still configure it so
  // out-of-process clients (Postman, mobile apps, other FE origins) can call
  // the API. Allow the explicitly configured FRONTEND_URL plus the same host.
  const allowedOrigins = new Set(
    [config.app.frontendUrl].filter(Boolean)
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow requests with no origin (curl, Postman, same-origin browser)
        if (!origin) return cb(null, true);
        if (allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
          return cb(null, true);
        }
        return cb(null, false);
      },
      credentials: true,
    }),
  );
  // Configure Helmet's CSP globally so it works for the Angular SPA.
  // Per-route res.setHeader() overrides are unreliable because Helmet's
  // middleware runs early and some Express internals re-check headers.
  // Setting it here means every HTML page (including the SPA) gets the
  // correct CSP from the start. API JSON responses are unaffected by CSP.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:  ["'self'"],
          scriptSrc:   ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://apis.google.com"],
          styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc:     ["'self'", "https://fonts.gstatic.com", "data:"],
          imgSrc:      ["'self'", "data:", "blob:", "https:", "http:"],
          connectSrc:  ["'self'", "ws:", "wss:", "https://accounts.google.com", "https://oauth2.googleapis.com", "https://api.cloudinary.com"],
          frameSrc:    ["https://accounts.google.com"],
          objectSrc:   ["'none'"],
        },
      },
    }),
  );

  // ─── LiveKit webhook ────────────────────────────────────────
  // Mounted BEFORE express.json() because LiveKit signs the RAW
  // request body. JSON parsing here would invalidate the signature.
  // Public endpoint (LiveKit calls it directly) — signature
  // verification inside the handler enforces authenticity.
  if (config.livekit.enabled) {
    app.post(
      config.livekit.webhookPath,
      express.raw({ type: "*/*", limit: "256kb" }),
      handleLivekitWebhook,
    );
    logger.info(
      { path: config.livekit.webhookPath },
      "LiveKit webhook receiver mounted",
    );
  } else {
    logger.warn(
      "LiveKit disabled (missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET). Call features will degrade to legacy mesh signaling.",
    );
  }

  // Body size limit (basic DoS protection)
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.use("/auth", authLimiter);
  app.use(generalLimiter);
  app.use("/uploads", express.static(path.resolve("./src/uploads")));

  // Local test harness — single-page HTML for manual end-to-end checks
  // (login + chat rooms + LiveKit calls). Dev convenience only; safe to
  // expose because every API call inside it still goes through the
  // normal auth pipeline.
  //
  // The CSP override is needed because the harness loads Tailwind,
  // Socket.IO and LiveKit clients from public CDNs. The default helmet
  // CSP (script-src 'self') would block them. We relax it for this path
  // only — every other route keeps the strict prod CSP.
  app.use(
    "/test",
    (req, res, next) => {
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self' https: data: blob:",
          "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.socket.io https://cdn.jsdelivr.net",
          "style-src 'self' 'unsafe-inline' https:",
          "connect-src 'self' ws: wss: https:",
          "img-src 'self' data: blob: https:",
          "media-src 'self' blob: data:",
        ].join("; "),
      );
      next();
    },
    express.static(path.resolve("./tests/frontend")),
  );

  // QA dashboard — focused on chat + calls. Same CSP relaxation as
  // /test since it also loads the Socket.IO client + Tailwind from CDNs.
  app.use(
    "/qa",
    (req, res, next) => {
      res.setHeader(
        "Content-Security-Policy",
        [
          "default-src 'self' https: data: blob:",
          "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.socket.io",
          "style-src 'self' 'unsafe-inline' https:",
          "connect-src 'self' ws: wss: https:",
          "img-src 'self' data: blob: https:",
        ].join("; "),
      );
      next();
    },
    express.static(path.resolve("./tests/qa-frontend")),
  );

  // ─── Health checks ──────────────────────────────────────────
  // Liveness must NEVER touch external dependencies (k8s restarts on failure).
  // Readiness gates traffic on DB/Redis reachability.
  app.get("/healthz", async (req, res) => {
    const data = await liveness();
    res.status(200).json({ success: true, message: "OK", data });
  });

  app.get("/readyz", async (req, res) => {
    const data = await readiness();
    const status = data.status === "ok" ? 200 : 503;
    res
      .status(status)
      .json({ success: status === 200, message: data.status, data });
  });

  // ─── API docs ───────────────────────────────────────────────
  // Public so partners can browse without an account. Spec is
  // hand-curated — extend src/utils/openapi/spec.js as endpoints
  // graduate from "internal" to "documented".
  app.get("/docs/openapi.json", (req, res) => res.json(openApiSpec));
  app.get("/docs", (req, res) => {
    // Swagger UI loads its CSS + JS from a CDN — relax CSP for /docs only.
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self' https: data: blob:",
        "script-src 'self' 'unsafe-inline' https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://unpkg.com",
        "img-src 'self' data: https:",
      ].join("; "),
    );
    res.type("html").send(swaggerHtml);
  });
  // ─── Routes ─────────────────────────────────────────────────
  // Helper to mount every controller under BOTH the legacy unversioned
  // path AND the canonical /api/v1 path. Lets old FE clients keep working
  // while new clients move to the explicit version prefix.
  const mountVersioned = (path, controller) => {
    app.use(path, controller);
    app.use(`/api/v1${path}`, controller);
  };

  mountVersioned("/auth", authController);
  mountVersioned("/user", userController);
  mountVersioned("/org", organizationController);

  // ── Project module is DEPRECATED ────────────────────────────
  // The FE has migrated to Spaces; tasks live under spaces, not
  // projects. The routes are still mounted so legacy clients keep
  // working, but every response carries a Deprecation header so
  // dashboards can spot stragglers. Remove this block entirely
  // once analytics confirm no live traffic.
  const deprecatedProjectShim = (req, res, next) => {
    res.setHeader("Deprecation", "true");
    res.setHeader(
      "Sunset",
      // Conservative sunset date — bump it forward each release until
      // we have zero hits in metrics, then delete the routes.
      "Wed, 31 Dec 2026 23:59:59 GMT",
    );
    res.setHeader(
      "Link",
      '</api/v1/org/:orgId/spaces>; rel="successor-version"',
    );
    next();
  };
  app.use("/org/:orgId/projects", deprecatedProjectShim, projectController);
  app.use(
    "/api/v1/org/:orgId/projects",
    deprecatedProjectShim,
    projectController,
  );

  mountVersioned("/sprints", sprintStatusController);
  mountVersioned("/me", meController);
  mountVersioned("/stars", starController);
  mountVersioned("/tasks/:taskId/comments", commentController);
  mountVersioned("/notifications", notificationController);
  mountVersioned("/teams", teamController);
  mountVersioned("/work-session", workSessionController);
  mountVersioned("/invite", inviteController);
  mountVersioned("/me/devices", deviceController);
  mountVersioned("/me/reminders", reminderController);
  mountVersioned("/meetings", meetingController);
  mountVersioned("/chat/rooms/:roomId/tabs", channelTabController);
  // Same /work-session prefix as the existing workSessionController so
  // screenshots and activity events sit naturally under their parent.
  mountVersioned("/work-session", screenshotController);
  mountVersioned("/work-session", activityEventController);
  mountVersioned("/dashboards", dashboardController);

  // ─── Chat ───────────────────────────────────────────────────
  mountVersioned("/chat/rooms", chatRoomController);
  mountVersioned("/chat/rooms/:roomId/messages", messageController);
  mountVersioned(
    "/chat/rooms/:roomId/messages/:messageId/reactions",
    reactionController,
  );

  // ─── Calls ──────────────────────────────────────────────────
  mountVersioned("/chat/rooms/:roomId/calls", callController);

  // ─── Angular SPA (production) ───────────────────────────────
  // When the Angular build exists in ./public we serve it here so a single
  // Railway/Render/Docker deployment hosts both frontend and backend.
  // API routes are all mounted above so they take priority.
  const frontendDist = path.resolve("./public");
  const indexHtml    = path.join(frontendDist, "index.html");
  let servingFrontend = false;
  try {
    const fs = await import("fs");
    servingFrontend = fs.existsSync(indexHtml);
  } catch { /* ignore */ }

  if (servingFrontend) {
    // Static assets (JS, CSS, images, fonts…)
    // CSP is now set globally via Helmet above — no per-route override needed.
    app.use(
      express.static(frontendDist, {
        maxAge: "1y",                   // immutable hashed files can be cached long
        index: false,                   // let the catch-all below handle /
        setHeaders(res, filePath) {
          // index.html must never be cached so fresh deploys are picked up
          if (filePath.endsWith("index.html")) {
            res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          }
        },
      }),
    );
    // Angular router — all non-API GET requests return index.html
    app.get("*", (req, res) => {
      res.sendFile(indexHtml);
    });
    logger.info({ dist: frontendDist }, "serving Angular SPA from backend");
  } else {
    // ─── 404 (API-only mode, no frontend build) ──────────────
    app.all("*", (req, res) => {
      res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.originalUrl} not found`,
        data: null,
      });
    });
  }

  // ─── Error Handler ──────────────────────────────────────────
  app.use(globalErrorHandling);

  // ─── DB + boot hooks ────────────────────────────────────────
  await connectDB();

  // SKIP_BACKGROUND_JOBS lets test suites mount the routes without
  // also starting cron timers (idle detection, etc.) — those leak
  // open handles across Jest workers and cause beforeAll timeouts.
  // Production never sets this.
  if (process.env.SKIP_BACKGROUND_JOBS !== "true") {
    await recoverOrphanedSessions();
    startIdleDetection();
  }
};

export default bootstrap;
