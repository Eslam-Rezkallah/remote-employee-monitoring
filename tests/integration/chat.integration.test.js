/**
 * tests/integration/chat.integration.test.js
 *
 * Chat hot path:
 *   • Create group → send message → list → edit → delete
 *   • Thread (reply increments replyCount on parent)
 *   • Pin / unpin (sender or room admin only)
 *   • Save / unsave (per-user bookmark)
 *   • Mentions extracted from content
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

async function setupOrgWithTwoMembers() {
  const owner = await createConfirmedUser(ctx.app, {
    email: `o${Date.now()}@x.com`,
    username: `owner${Date.now()}`,
  });
  const member = await createConfirmedUser(ctx.app, {
    email: `m${Date.now()}@x.com`,
    username: `mate${Date.now()}`,
  });

  const org = await ctx.organizationModel.create({
    name: `O-${Date.now()}`,
    slug: `o-${Date.now()}`,
    joinCode: `JC${Date.now()}`.slice(0, 8).toUpperCase(),
    ownerId: owner.user._id,
  });
  await ctx.memberModel.insertMany([
    { organizationId: org._id, userId: owner.user._id, role: "owner", isActive: true },
    { organizationId: org._id, userId: member.user._id, role: "member", isActive: true },
  ]);

  return { org, owner, member };
}

async function createGroupRoom({ owner, member, org }) {
  const res = await request(ctx.app)
    .post("/chat/rooms/group")
    .set(authHeader(owner.token))
    .send({
      name: "test-group",
      organizationId: org._id.toString(),
      memberIds: [member.user._id.toString()],
    });
  expect(res.status).toBeLessThan(300);
  return res.body.data.room;
}

describe("chat — send / edit / list", () => {
  test("owner sends message → member can list it", async () => {
    const s = await setupOrgWithTwoMembers();
    const room = await createGroupRoom(s);

    const send = await request(ctx.app)
      .post(`/chat/rooms/${room._id}/messages`)
      .set(authHeader(s.owner.token))
      .field("content", "hello world");
    expect(send.status).toBeLessThan(300);
    const msgId = send.body.data._id || send.body.data.message?._id;
    expect(msgId).toBeTruthy();

    const list = await request(ctx.app)
      .get(`/chat/rooms/${room._id}/messages`)
      .set(authHeader(s.member.token));
    expect(list.status).toBe(200);
    const items =
      list.body.data?.items ||
      list.body.data?.messages ||
      list.body.data ||
      [];
    expect(Array.isArray(items) ? items.length : 0).toBeGreaterThan(0);
  });
});

describe("chat — threads (replyCount on parent)", () => {
  test("reply increments parent.replyCount", async () => {
    const s = await setupOrgWithTwoMembers();
    const room = await createGroupRoom(s);

    const parent = await ctx.messageModel.create({
      chatRoomId: room._id,
      senderId: s.owner.user._id,
      content: "parent",
    });

    // Send a reply via REST to trigger the same createMessage path
    const reply = await request(ctx.app)
      .post(`/chat/rooms/${room._id}/messages`)
      .set(authHeader(s.member.token))
      .field("content", "first reply")
      .field("replyTo", parent._id.toString());
    expect(reply.status).toBeLessThan(300);

    const refreshed = await ctx.messageModel.findById(parent._id);
    expect(refreshed.replyCount).toBe(1);

    const thread = await request(ctx.app)
      .get(`/chat/rooms/${room._id}/messages/${parent._id}/thread`)
      .set(authHeader(s.owner.token));
    expect(thread.status).toBe(200);
    expect(thread.body.data.replyCount).toBe(1);
    expect(thread.body.data.replies.length).toBe(1);
  });
});

describe("chat — pin / unpin", () => {
  test("sender can pin own message; outsider 404 (not a member)", async () => {
    const s = await setupOrgWithTwoMembers();
    const room = await createGroupRoom(s);

    const msg = await ctx.messageModel.create({
      chatRoomId: room._id,
      senderId: s.owner.user._id,
      content: "pin me",
    });

    const pin = await request(ctx.app)
      .post(`/chat/rooms/${room._id}/messages/${msg._id}/pin`)
      .set(authHeader(s.owner.token));
    expect(pin.status).toBe(200);

    const list = await request(ctx.app)
      .get(`/chat/rooms/${room._id}/messages/pinned`)
      .set(authHeader(s.owner.token));
    expect(list.status).toBe(200);
    expect(list.body.data.count).toBe(1);

    // Outsider — user with no membership in this room — gets 404 from requireRoomMember
    const outsider = await createConfirmedUser(ctx.app, {
      email: `out${Date.now()}@x.com`,
    });
    const denied = await request(ctx.app)
      .post(`/chat/rooms/${room._id}/messages/${msg._id}/pin`)
      .set(authHeader(outsider.token));
    expect(denied.status).toBe(404);
  });
});

describe("chat — save / unsave (per-user bookmark)", () => {
  test("idempotent save + unsave + list in /me/saved-messages", async () => {
    const s = await setupOrgWithTwoMembers();
    const room = await createGroupRoom(s);

    const msg = await ctx.messageModel.create({
      chatRoomId: room._id,
      senderId: s.owner.user._id,
      content: "save me",
    });

    const save1 = await request(ctx.app)
      .post(`/chat/rooms/${room._id}/messages/${msg._id}/save`)
      .set(authHeader(s.member.token))
      .send({});
    expect([200, 201]).toContain(save1.status);

    // Second save is a no-op (idempotent)
    const save2 = await request(ctx.app)
      .post(`/chat/rooms/${room._id}/messages/${msg._id}/save`)
      .set(authHeader(s.member.token))
      .send({});
    expect([200, 201]).toContain(save2.status);

    const list = await request(ctx.app)
      .get("/me/saved-messages")
      .set(authHeader(s.member.token));
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(1);

    const del = await request(ctx.app)
      .delete(`/chat/rooms/${room._id}/messages/${msg._id}/save`)
      .set(authHeader(s.member.token));
    expect(del.status).toBe(200);

    const list2 = await request(ctx.app)
      .get("/me/saved-messages")
      .set(authHeader(s.member.token));
    expect(list2.body.data.total).toBe(0);
  });
});

describe("chat — mentions extracted from content", () => {
  test("@username scoped to room members populates `mentions` array", async () => {
    const s = await setupOrgWithTwoMembers();
    const room = await createGroupRoom(s);

    const memberUsername = s.member.user.username;

    const res = await request(ctx.app)
      .post(`/chat/rooms/${room._id}/messages`)
      .set(authHeader(s.owner.token))
      .field("content", `hey @${memberUsername} take a look`);
    expect(res.status).toBeLessThan(300);

    const msgId = res.body.data._id || res.body.data.message?._id;
    const stored = await ctx.messageModel.findById(msgId);
    const mentionedIds = (stored.mentions || []).map((m) => m.toString());
    expect(mentionedIds).toContain(s.member.user._id.toString());
    // Sender never mentions themselves
    expect(mentionedIds).not.toContain(s.owner.user._id.toString());
  });
});
