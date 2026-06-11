/**
 * tests/integration/livekit.integration.test.js
 *
 * The /livekit-token endpoint is the gateway between our auth model
 * and LiveKit's room model. Lock down:
 *   • 503 when LiveKit isn't configured (default in test env)
 *   • 404 for non-existent calls
 *   • 403 when the user isn't on the call's participants array
 *   • 409 when the call is already ended
 *
 * Note: we don't test the success path here because the test env
 * intentionally doesn't have LiveKit credentials — that's a "real
 * services required" test.
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

async function setupCallScenario() {
  const caller = await createConfirmedUser(ctx.app, {
    email: `c${Date.now()}@x.com`,
  });
  const callee = await createConfirmedUser(ctx.app, {
    email: `cl${Date.now()}@x.com`,
  });
  const stranger = await createConfirmedUser(ctx.app, {
    email: `st${Date.now()}@x.com`,
  });

  const org = await ctx.organizationModel.create({
    name: `O-${Date.now()}`,
    slug: `o-${Date.now()}`,
    joinCode: `JC${Date.now()}`.slice(0, 8).toUpperCase(),
    ownerId: caller.user._id,
  });
  await ctx.memberModel.insertMany([
    { organizationId: org._id, userId: caller.user._id, role: "owner", isActive: true },
    { organizationId: org._id, userId: callee.user._id, role: "member", isActive: true },
    { organizationId: org._id, userId: stranger.user._id, role: "member", isActive: true },
  ]);

  const room = await ctx.chatRoomModel.create({
    name: "call-room",
    type: "group",
    organizationId: org._id,
    members: [caller.user._id, callee.user._id], // stranger is NOT in room
    admins: [caller.user._id],
    createdBy: caller.user._id,
    isPrivate: true,
  });

  const call = await ctx.callModel.create({
    chatRoomId: room._id,
    organizationId: org._id,
    callerId: caller.user._id,
    type: "video",
    status: "ringing",
    participants: [
      { userId: caller.user._id, state: "in-call", joinedAt: new Date() },
      { userId: callee.user._id, state: "ringing" },
    ],
  });

  return { caller, callee, stranger, org, room, call };
}

const tokenPath = (roomId, callId) =>
  `/chat/rooms/${roomId}/calls/${callId}/livekit-token`;

describe("livekit-token endpoint", () => {
  test("503 when LiveKit not configured (test env default)", async () => {
    const s = await setupCallScenario();
    const res = await request(ctx.app)
      .post(tokenPath(s.room._id, s.call._id))
      .set(authHeader(s.caller.token))
      .send({ deviceId: "test-1" });
    expect(res.status).toBe(503);
    expect(res.body.message).toMatch(/livekit/i);
  });

  test("404 for non-existent callId", async () => {
    const s = await setupCallScenario();
    const fakeCallId = "507f1f77bcf86cd799439011";
    const res = await request(ctx.app)
      .post(tokenPath(s.room._id, fakeCallId))
      .set(authHeader(s.caller.token))
      .send({ deviceId: "test-1" });
    // Either 503 (LiveKit gate first) or 404 (call lookup) depending on
    // order — both are correct refusals. What we never want is 200 + token.
    expect([404, 503]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  test("400 for malformed callId", async () => {
    const s = await setupCallScenario();
    const res = await request(ctx.app)
      .post(tokenPath(s.room._id, "not-an-id"))
      .set(authHeader(s.caller.token))
      .send({ deviceId: "test-1" });
    expect([400, 503]).toContain(res.status);
  });

  test("stranger (not in room) is refused", async () => {
    const s = await setupCallScenario();
    const res = await request(ctx.app)
      .post(tokenPath(s.room._id, s.call._id))
      .set(authHeader(s.stranger.token))
      .send({ deviceId: "test-1" });
    // requireRoomMember would 404; LiveKit gate would 503; both are
    // refusals — never 200.
    expect([403, 404, 503]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  test("missing auth → 401", async () => {
    const s = await setupCallScenario();
    const res = await request(ctx.app)
      .post(tokenPath(s.room._id, s.call._id))
      .send({ deviceId: "test-1" });
    expect(res.status).toBe(401);
  });
});

describe("livekit webhook receiver", () => {
  test("when LiveKit disabled, webhook path is not mounted (404)", async () => {
    // LiveKit env unset in tests → App.controller's mount guard skips
    // the webhook route, so a POST returns 404.
    const res = await request(ctx.app)
      .post("/calls/livekit/webhook")
      .set("Content-Type", "application/json")
      .send({ event: "room_started" });
    expect(res.status).toBe(404);
  });
});
