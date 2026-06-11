/**
 * utils/openapi/spec.js
 *
 * Minimal hand-maintained OpenAPI 3.0 spec.
 *
 * This is intentionally a sketch — it documents the auth, conventions,
 * and the most-used endpoints. The goal isn't 100% coverage (we'd need
 * a Joi→OpenAPI generator for that); it's giving FE engineers a single
 * URL to hit when they need to know "how do I authenticate" or "what
 * does the response shape look like".
 *
 * Mounted at `/docs/openapi.json` + `/docs` (Swagger UI via CDN).
 *
 * To extend: add another entry under `paths`. Keep the response shape
 * matching the actual successResponse / globalErrorHandling output.
 */

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "REM Backend API",
    version: "1.0.0",
    description: [
      "Unified backend for the REM collaboration platform.",
      "",
      "## Auth",
      "Every authenticated route requires `Authorization: Bearer <jwt>`.",
      "Tokens are issued by `POST /auth/login` and refreshed via",
      "`POST /auth/refresh`.",
      "",
      "## Conventions",
      "- Success responses: `{ success: true, message, data }`",
      "- Error responses: `{ success: false, message, data: null, details? }`",
      "- Pagination: `?page=1&limit=20` → `{ items, total, page, limit }`",
      "- Every route is also available under `/api/v1` (e.g.,",
      "  `/api/v1/auth/login`).",
    ].join("\n"),
  },
  servers: [
    { url: "/", description: "Current host (legacy unversioned)" },
    { url: "/api/v1", description: "Current host (versioned)" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      Success: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          message: { type: "string" },
          data: {},
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string", example: "Invalid credentials" },
          data: { type: "null" },
          details: {},
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    "/healthz": {
      get: {
        summary: "Liveness probe",
        tags: ["Ops"],
        security: [],
        responses: { 200: { description: "Process is alive" } },
      },
    },
    "/readyz": {
      get: {
        summary: "Readiness probe (DB + Redis)",
        tags: ["Ops"],
        security: [],
        responses: {
          200: { description: "Ready to serve traffic" },
          503: { description: "Degraded — one dep is unreachable" },
        },
      },
    },
    "/metrics": {
      get: {
        summary: "Prometheus metrics",
        tags: ["Ops"],
        security: [],
        responses: { 200: { description: "Exposition format" } },
      },
    },
    "/auth/signup": {
      post: {
        summary: "Create a new user account",
        tags: ["Auth"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["username", "email", "password", "confirmPassword"],
                properties: {
                  username: { type: "string" },
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password" },
                  confirmPassword: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Account created; OTP emailed" } },
      },
    },
    "/auth/login": {
      post: {
        summary: "Login with email + password",
        tags: ["Auth"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string", format: "password" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description:
              "Returns { accessToken, refreshToken, user } OR { requiresOTP: true } if 2FA is enabled",
          },
          401: { description: "Bad credentials" },
          429: {
            description: "Account temporarily locked (brute-force lockout)",
          },
        },
      },
    },
    "/me/devices": {
      post: {
        summary: "Register a push notification token",
        tags: ["Me"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "platform"],
                properties: {
                  token: { type: "string" },
                  platform: {
                    type: "string",
                    enum: ["web", "ios", "android"],
                  },
                  label: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Device registered" } },
      },
      get: {
        summary: "List my registered push devices",
        tags: ["Me"],
        responses: { 200: { description: "List of devices" } },
      },
      delete: {
        summary: "Unregister a push token",
        tags: ["Me"],
        responses: { 200: { description: "Token unregistered" } },
      },
    },
    "/org/{orgId}/spaces/{spaceId}/tasks/{taskId}/status": {
      patch: {
        summary: "Change task status (Kanban transition)",
        tags: ["Tasks"],
        parameters: [
          { name: "orgId", in: "path", required: true, schema: { type: "string" } },
          { name: "spaceId", in: "path", required: true, schema: { type: "string" } },
          { name: "taskId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: { status: { type: "string" } },
              },
            },
          },
        },
        responses: {
          200: { description: "Status updated" },
          400: { description: "Status not in this space's workflow" },
          403: { description: "Not assignee/reporter/admin" },
        },
      },
    },
    "/chat/rooms/{roomId}/messages/{messageId}/thread": {
      get: {
        summary: "List replies for a message (thread view)",
        tags: ["Chat"],
        parameters: [
          { name: "roomId", in: "path", required: true, schema: { type: "string" } },
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "{ parent, replyCount, replies[] }" } },
      },
    },
    "/chat/rooms/{roomId}/calls/{callId}/livekit-token": {
      post: {
        summary: "Mint a LiveKit JWT for joining the call's media room",
        tags: ["Calls"],
        parameters: [
          { name: "roomId", in: "path", required: true, schema: { type: "string" } },
          { name: "callId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { deviceId: { type: "string" } },
              },
            },
          },
        },
        responses: {
          200: { description: "{ url, token, identity, room, ttl }" },
          403: { description: "Not a participant" },
          404: { description: "Call not found" },
          503: { description: "LiveKit not configured" },
        },
      },
    },
  },
};

/** Self-contained Swagger UI page that pulls the spec from /docs/openapi.json. */
export const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>REM API — Swagger UI</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"
    />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        SwaggerUIBundle({
          url: "/docs/openapi.json",
          dom_id: "#swagger-ui",
          presets: [SwaggerUIBundle.presets.apis],
          deepLinking: true,
        });
      };
    </script>
  </body>
</html>`;
