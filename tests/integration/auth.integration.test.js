/**
 * tests/integration/auth.integration.test.js
 *
 * Hot-path coverage for the auth flow:
 *   • Login happy path → returns access + refresh tokens
 *   • Login wrong password → 401, audit row written, counter incremented
 *   • Login N times wrong → 429 lockout + Retry-After header
 *   • Logout revokes the refresh token
 *
 * Reads the audit log directly to confirm the security trail is written
 * — `recordAudit` is fire-and-forget, so missing writes are silent in
 * prod. Tests are the safety net.
 */

import request from "supertest";
import { jest } from "@jest/globals";
import {
  bootApp,
  resetDb,
  shutdownApp,
  createConfirmedUser,
  authHeader,
} from "./setup.js";

jest.setTimeout(90_000);

let ctx;

beforeAll(async () => {
  ctx = await bootApp();
});
afterAll(async () => {
  await shutdownApp();
});
afterEach(async () => {
  await resetDb();
});

async function getAuditLogs(action) {
  const auditLogModel = (await import("../../src/DB/Model/auditLog.model.js"))
    .default;
  const filter = action ? { action } : {};
  return auditLogModel.find(filter).sort({ createdAt: -1 }).lean();
}

describe("auth — login", () => {
  test("POST /auth/login → 200 + tokens + audit", async () => {
    const { user } = await createConfirmedUser(ctx.app, {
      email: "a@example.com",
    });

    const res = await request(ctx.app)
      .post("/auth/login")
      .send({ email: "a@example.com", password: "TestPass1!" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.user._id).toBe(user._id.toString());

    // Audit row exists and is tagged success
    // (small wait — recordAudit fires without await)
    await new Promise((r) => setTimeout(r, 50));
    const audits = await getAuditLogs("auth.login.success");
    expect(audits).toHaveLength(1);
    expect(audits[0].outcome).toBe("success");
  });

  test("POST /auth/login wrong password → 401 + failure audit + counter++", async () => {
    await createConfirmedUser(ctx.app, { email: "b@example.com" });

    const res = await request(ctx.app)
      .post("/auth/login")
      .send({ email: "b@example.com", password: "WrongPass1!" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);

    await new Promise((r) => setTimeout(r, 50));
    const audits = await getAuditLogs("auth.login.failure");
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0].meta.reason).toBe("bad_password");
    expect(audits[0].meta.attempts).toBe(1);

    const user = await ctx.userModel.findOne({ email: "b@example.com" });
    expect(user.loginFailedAttempts).toBe(1);
    expect(user.loginLockedUntil).toBeNull();
  });

  test("POST /auth/login 5x wrong → 429 lockout + Retry-After + audit locked=true", async () => {
    await createConfirmedUser(ctx.app, { email: "c@example.com" });

    // First 5 attempts: 401 each. On the 5th we expect the lock to set.
    for (let i = 0; i < 5; i++) {
      const r = await request(ctx.app)
        .post("/auth/login")
        .send({ email: "c@example.com", password: "WrongPass1!" });
      expect(r.status).toBe(401);
    }

    // 6th attempt → 429 + Retry-After header
    const locked = await request(ctx.app)
      .post("/auth/login")
      .send({ email: "c@example.com", password: "WrongPass1!" });
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toMatch(/^\d+$/);

    const user = await ctx.userModel.findOne({ email: "c@example.com" });
    expect(user.loginFailedAttempts).toBeGreaterThanOrEqual(5);
    expect(user.loginLockedUntil).toBeInstanceOf(Date);
    expect(user.loginLockedUntil.getTime()).toBeGreaterThan(Date.now());

    await new Promise((r) => setTimeout(r, 50));
    const audits = await getAuditLogs("auth.login.failure");
    const lockedAudit = audits.find((a) => a.meta?.locked === true);
    expect(lockedAudit).toBeDefined();
  });

  test("right password resets counter + lock", async () => {
    const { user } = await createConfirmedUser(ctx.app, {
      email: "d@example.com",
    });

    // Pre-load some failed attempts on the user
    await ctx.userModel.updateOne(
      { _id: user._id },
      { $set: { loginFailedAttempts: 3 } },
    );

    const res = await request(ctx.app)
      .post("/auth/login")
      .send({ email: "d@example.com", password: "TestPass1!" });
    expect(res.status).toBe(200);

    const fresh = await ctx.userModel.findOne({ email: "d@example.com" });
    expect(fresh.loginFailedAttempts).toBe(0);
    expect(fresh.loginLockedUntil).toBeNull();
  });

  test("POST /auth/login non-existent user → 401 + audit user_not_found", async () => {
    const res = await request(ctx.app)
      .post("/auth/login")
      .send({ email: "ghost@example.com", password: "WrongPass1!" });
    expect(res.status).toBe(401);

    await new Promise((r) => setTimeout(r, 50));
    const audits = await getAuditLogs("auth.login.failure");
    expect(audits[0].meta.reason).toBe("user_not_found");
  });
});

describe("auth — logout", () => {
  test("POST /auth/logout revokes the refresh token + audit", async () => {
    const { user } = await createConfirmedUser(ctx.app, {
      email: "lo@example.com",
    });
    const login = await request(ctx.app)
      .post("/auth/login")
      .send({ email: "lo@example.com", password: "TestPass1!" });
    const { accessToken, refreshToken } = login.body.data;

    const res = await request(ctx.app)
      .post("/auth/logout")
      .set(authHeader(accessToken))
      .send({ refreshToken });
    expect(res.status).toBe(200);

    const refreshTokenModel = (
      await import("../../src/DB/Model/refreshToken.model.js")
    ).default;
    const rt = await refreshTokenModel.findOne({ userId: user._id });
    expect(rt.revokedAt).toBeInstanceOf(Date);

    await new Promise((r) => setTimeout(r, 50));
    const audits = await getAuditLogs("auth.logout");
    expect(audits).toHaveLength(1);
  });
});
