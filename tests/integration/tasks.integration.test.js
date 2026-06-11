/**
 * tests/integration/tasks.integration.test.js
 *
 * Coverage for the task hot path:
 *   • Create task (assignee must be in org)
 *   • Change status (assignee/reporter/admin allowed; others 403)
 *   • Assign (reporter/admin only — NOT assignee)
 *   • Delete (reporter/admin only — NOT assignee)
 *   • Update due date (assignee/reporter/admin — fixed bug we shipped)
 *
 * Permission rules are the heart of the access-control model — these
 * tests pin them so a future refactor can't silently weaken them.
 */

import request from "supertest";
import { jest } from "@jest/globals";
import mongoose from "mongoose";
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

/**
 * Build a fully-set-up scenario in one call:
 *   org + members (reporter, assignee, stranger) + space + workflow defaults
 *   + a fresh task whose reporter=R, assignee=A.
 *
 * Returns tokens + ids so each test only writes the request it cares about.
 */
async function setupScenario() {
  const reporter = await createConfirmedUser(ctx.app, {
    email: `r${Date.now()}@x.com`,
  });
  const assignee = await createConfirmedUser(ctx.app, {
    email: `a${Date.now()}@x.com`,
  });
  const stranger = await createConfirmedUser(ctx.app, {
    email: `s${Date.now()}@x.com`,
  });
  const admin = await createConfirmedUser(ctx.app, {
    email: `adm${Date.now()}@x.com`,
  });

  const organizationModel = ctx.organizationModel;
  const memberModel = ctx.memberModel;

  const org = await organizationModel.create({
    name: `Org-${Date.now()}`,
    slug: `org-${Date.now()}`,
    joinCode: `JC${Date.now()}`.slice(0, 8).toUpperCase(),
    ownerId: reporter.user._id,
  });
  await memberModel.insertMany([
    {
      organizationId: org._id,
      userId: reporter.user._id,
      role: "owner",
      isActive: true,
    },
    {
      organizationId: org._id,
      userId: assignee.user._id,
      role: "member",
      isActive: true,
    },
    {
      organizationId: org._id,
      userId: admin.user._id,
      role: "admin",
      isActive: true,
    },
    // stranger is intentionally NOT in the org
  ]);

  const space = await ctx.spaceModel.create({
    name: "Test Space",
    type: "Project",
    organizationId: org._id,
    createdBy: reporter.user._id,
  });

  const task = await ctx.taskModel.create({
    title: "Initial",
    organizationId: org._id,
    spaceId: space._id,
    reporterId: reporter.user._id,
    assigneeId: assignee.user._id,
  });

  return {
    org,
    space,
    task,
    reporter,
    assignee,
    stranger,
    admin,
  };
}

const base = (orgId, spaceId) =>
  `/org/${orgId}/spaces/${spaceId}/tasks`;

describe("tasks — create", () => {
  test("creates with reporter = current user; rejects assignee not in org", async () => {
    const s = await setupScenario();

    const ok = await request(ctx.app)
      .post(base(s.org._id, s.space._id))
      .set(authHeader(s.reporter.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        title: "Real task",
        assigneeId: s.assignee.user._id.toString(),
      });
    expect(ok.status).toBe(201);
    expect(ok.body.data.reporterId.toString()).toBe(
      s.reporter.user._id.toString(),
    );

    const bad = await request(ctx.app)
      .post(base(s.org._id, s.space._id))
      .set(authHeader(s.reporter.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        title: "Bad assignee",
        assigneeId: s.stranger.user._id.toString(),
      });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/not an active member/i);
  });
});

describe("tasks — change status", () => {
  test("assignee can change status", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/status`)
      .set(authHeader(s.assignee.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        status: "InProgress",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("InProgress");
  });

  test("reporter can change status", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/status`)
      .set(authHeader(s.reporter.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        status: "Done",
      });
    expect(res.status).toBe(200);
  });

  test("stranger (not in org) → 403", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/status`)
      .set(authHeader(s.stranger.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        status: "Done",
      });
    expect(res.status).toBe(403);
  });

  test("invalid status → 400 explaining workflow", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/status`)
      .set(authHeader(s.assignee.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        status: "Yolo",
      });
    // Joi validator catches "Yolo" first (enum check) → 400
    expect(res.status).toBe(400);
  });
});

describe("tasks — assign", () => {
  test("assignee CANNOT reassign themselves away (accountability)", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/assign`)
      .set(authHeader(s.assignee.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        assigneeId: null,
      });
    expect(res.status).toBe(403);
  });

  test("reporter can reassign", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/assign`)
      .set(authHeader(s.reporter.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        assigneeId: s.admin.user._id.toString(),
      });
    expect(res.status).toBe(200);
    expect(String(res.body.data.assigneeId._id || res.body.data.assigneeId)).toBe(
      s.admin.user._id.toString(),
    );
  });

  test("admin can reassign", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/assign`)
      .set(authHeader(s.admin.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        assigneeId: null,
      });
    expect(res.status).toBe(200);
  });
});

describe("tasks — delete", () => {
  test("assignee CANNOT delete (accountability)", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .delete(`${base(s.org._id, s.space._id)}/${s.task._id}`)
      .set(authHeader(s.assignee.token));
    expect(res.status).toBe(403);
    // Task still there
    const fresh = await ctx.taskModel.findById(s.task._id);
    expect(fresh.isDeleted).toBe(false);
  });

  test("reporter can delete (soft)", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .delete(`${base(s.org._id, s.space._id)}/${s.task._id}`)
      .set(authHeader(s.reporter.token));
    expect(res.status).toBe(200);
    const fresh = await ctx.taskModel.findById(s.task._id);
    expect(fresh.isDeleted).toBe(true);
  });
});

describe("tasks — due date access control (regression test)", () => {
  test("stranger in org but not assignee/reporter → 403", async () => {
    const s = await setupScenario();
    // Make stranger an active org member but NOT assignee/reporter on the task
    await ctx.memberModel.create({
      organizationId: s.org._id,
      userId: s.stranger.user._id,
      role: "member",
      isActive: true,
    });

    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/due-date`)
      .set(authHeader(s.stranger.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        dueDate: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(res.status).toBe(403);
  });

  test("assignee can update due date", async () => {
    const s = await setupScenario();
    const res = await request(ctx.app)
      .patch(`${base(s.org._id, s.space._id)}/${s.task._id}/due-date`)
      .set(authHeader(s.assignee.token))
      .send({
        orgId: s.org._id.toString(),
        spaceId: s.space._id.toString(),
        taskId: s.task._id.toString(),
        dueDate: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(res.status).toBe(200);
  });
});
