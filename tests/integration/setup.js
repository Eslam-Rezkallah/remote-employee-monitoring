/**
 * tests/integration/setup.js
 *
 * Shared bootstrap for integration tests:
 *   • Spins up mongodb-memory-server (no external Mongo needed)
 *   • Bypasses src/config/env.js validation by setting required env vars
 *     BEFORE the app modules load.
 *   • Builds an Express app via the real `bootstrap()` so middleware,
 *     error handler, and routes match production.
 *   • Provides helpers: makeApp(), createUser(), authHeader(token),
 *     and a teardown that flushes mongo + closes connections.
 *
 * Why mongodb-memory-server: each test file gets its own in-process
 * Mongo instance with its own ephemeral data dir. Tests run in parallel
 * without fixtures colliding, and CI doesn't need a sidecar service.
 *
 * NOT a Jest globalSetup — each test file imports + awaits `bootApp()`
 * so failures isolate to that file and the suite name in CI output
 * stays useful.
 */

import mongoose from "mongoose";
import crypto from "node:crypto";

/**
 * Mongo strategy: prefer a LOCAL MongoDB at 127.0.0.1:27017 with a
 * unique throwaway database name per test file. Falls back to
 * mongodb-memory-server when local isn't reachable (CI scenario).
 *
 * Why: mongo-memory-server downloads a ~100MB Mongo binary on first
 * run, which times out in slow networks and blocks `beforeAll`. A
 * local Mongo is instant.
 */
const LOCAL_MONGO = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";

async function tryConnectLocal(dbName) {
  const uri = `${LOCAL_MONGO}/${dbName}`;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });
    return uri;
  } catch {
    await mongoose.disconnect().catch(() => {});
    return null;
  }
}

// Lock env vars BEFORE any of our app modules load. The config validator
// rejects boot otherwise.
function seedTestEnv(dbUri) {
  Object.assign(process.env, {
    MOOD: "DEV",
    APP_NAME: "REM-test",
    PORT: "0",
    DB_URI: dbUri,
    SALT: "10",
    ACCESS_TOKEN_EXPIRATION: "15m",
    REFRESH_TOKEN_EXPIRATION: "7d",
    USER_ACCESS_TOKEN: "test-user-access-token-must-be-at-least-32-chars",
    USER_REFRESH_TOKEN: "test-user-refresh-token-must-be-at-least-32-chars",
    ADMIN_ACCESS_TOKEN: "test-admin-access-token-must-be-at-least-32-chars",
    ADMIN_REFRESH_TOKEN: "test-admin-refresh-token-must-be-at-least-32-chars",
    EMAIL: "test@example.com",
    EMAIL_PASSWORD: "test-placeholder",
    CLOUDINARY_CLOUD_NAME: "test",
    CLOUDINARY_API_KEY: "test",
    CLOUDINARY_API_SECRET: "test",
    GOOGLE_CLIENT_ID: "test.apps.googleusercontent.com",
    FRONTEND_URL: "http://localhost:3000",
    // Keep optional features off during tests so we don't pay the
    // overhead and don't depend on external services.
    LOG_LEVEL: "silent",
    // Skip cron timers, idle-detection, orphan recovery, etc. These
    // leak open handles in Jest workers and cause beforeAll timeouts.
    SKIP_BACKGROUND_JOBS: "true",
  });
  // REDIS_URL deliberately UNSET so config.redis.enabled === false
  // and the Socket.IO/cache layers run in their in-memory fallbacks.
  delete process.env.REDIS_URL;
}

let _mongo = null;          // mongo-memory-server instance when used
let _localDbName = null;    // local-mongo test database name when used
let _app = null;
let _models = null;

/**
 * Boots the full app once. Idempotent — subsequent calls return the
 * cached app instance, so beforeAll() can call this freely.
 *
 * Internally we:
 *   1. Spin up mongo-memory-server and CONNECT to it manually before
 *      importing app modules — this stops `connectDB` inside bootstrap
 *      from racing against the test connection.
 *   2. Seed env BEFORE the first `import("../../src/...")` so the
 *      config validator sees the test values.
 */
export async function bootApp() {
  if (_app) return { app: _app, mongoose, ...(_models || {}) };

  // Unique DB name per test file run so parallel Jest workers don't
  // clobber each other's data even on the same local instance.
  _localDbName = `REM-test-${crypto.randomBytes(6).toString("hex")}`;

  let mongoUri = await tryConnectLocal(_localDbName);

  if (!mongoUri) {
    // Local mongo unreachable → fall back to in-memory (CI).
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    _mongo = await MongoMemoryServer.create();
    mongoUri = _mongo.getUri("rem-test");
    await mongoose.connect(mongoUri);
  }

  seedTestEnv(mongoUri);

  // Dynamic import AFTER env is seeded so config/env.js validation passes.
  const [{ default: express }, { default: bootstrap }] = await Promise.all([
    import("express"),
    import("../../src/App.controller.js"),
  ]);
  const app = express();
  await bootstrap(app, express);

  // Common models exposed so tests don't need to know the deep paths.
  const userModel = (await import("../../src/DB/Model/user.model.js")).default;
  const memberModel = (await import("../../src/DB/Model/member.model.js"))
    .default;
  const organizationModel = (
    await import("../../src/DB/Model/organization.model.js")
  ).default;
  const chatRoomModel = (await import("../../src/DB/Model/chatroom.model.js"))
    .default;
  const messageModel = (await import("../../src/DB/Model/message.model.js"))
    .default;
  const taskModel = (await import("../../src/DB/Model/task.model.js")).default;
  const spaceModel = (await import("../../src/DB/Model/space.model.js"))
    .default;
  const callModel = (await import("../../src/DB/Model/call.model.js")).default;

  _models = {
    userModel,
    memberModel,
    organizationModel,
    chatRoomModel,
    messageModel,
    taskModel,
    spaceModel,
    callModel,
  };
  _app = app;
  return { app, mongoose, ..._models };
}

/**
 * Wipe every collection between tests. Faster than re-creating the
 * mongo-memory-server because connection pools stay warm.
 */
export async function resetDb() {
  if (!_mongo) return;
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

/**
 * Default Jest timeout is 5s; mongo-memory-server's first run downloads
 * a Mongo binary (can be 100MB) on a cold CI machine, plus bootstrap
 * loads ~180 source files. 60s is the right ceiling — passes locally
 * in <5s once cached, gives CI room on cold start.
 */
export function applyJestTimeouts(jest, beforeAllSeconds = 60) {
  if (jest?.setTimeout) jest.setTimeout(beforeAllSeconds * 1000);
}

/**
 * Tear down at the end of a test file. Pair with afterAll().
 *
 * We stop the in-process cron jobs explicitly because even though
 * SKIP_BACKGROUND_JOBS=true prevents them from STARTING via bootstrap,
 * some modules (notification.event, redis client) may have registered
 * intervals on import. Best-effort — never throws.
 */
export async function shutdownApp() {
  try {
    const { stopIdleDetection } = await import(
      "../../src/utils/jobs/idle.detection.job.js"
    );
    stopIdleDetection?.();
  } catch {
    /* noop */
  }
  // Drop the throwaway test database so we don't leave artifacts on
  // the local server between runs.
  try {
    if (_localDbName && mongoose.connection?.db) {
      await mongoose.connection.db.dropDatabase();
    }
  } catch {
    /* noop */
  }
  try {
    await mongoose.disconnect();
  } catch {
    /* noop */
  }
  if (_mongo) {
    await _mongo.stop();
    _mongo = null;
  }
  _localDbName = null;
  _app = null;
  _models = null;
}

/**
 * Build an Authorization header for a freshly-issued user token.
 * Skips the email-confirmation OTP dance so tests stay terse.
 *
 *   const { user, token } = await createConfirmedUser(app, { email });
 *   const res = await request(app).get("/me").set(authHeader(token));
 */
export async function createConfirmedUser(
  app,
  { email = `t${Date.now()}@example.com`, username, password = "TestPass1!" } = {},
) {
  // bcrypt-hash the password ourselves so we don't hit the signup endpoint
  // (which would require the email OTP flow). Cheaper + deterministic.
  const { generateHash } = await import(
    "../../src/utils/security/hash.security.js"
  );
  const { generateAccessToken } = await import(
    "../../src/utils/security/token.security.js"
  );
  const userModel = (await import("../../src/DB/Model/user.model.js")).default;
  const { roleTypes, providerTypes } = await import(
    "../../src/DB/Model/user.model.js"
  );

  const user = await userModel.create({
    username: username || `u${Date.now()}`,
    email,
    password: generateHash({ plainText: password }),
    provider: providerTypes.System,
    role: roleTypes.Member,
    confirmEmail: true,
  });

  const token = generateAccessToken({
    payload: { id: user._id },
    role: user.role,
  });

  return { user, token, password };
}

export function authHeader(token, scheme = "Bearer") {
  return { Authorization: `${scheme} ${token}` };
}
