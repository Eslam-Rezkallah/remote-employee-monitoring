/**
 * tests/unit/task.permissions.test.js
 *
 * Locks in the access-control matrix for tasks. If any of these
 * fail, somebody changed the permission semantics — make sure that
 * was intentional before updating the test.
 *
 * Mocks the DB layer so the suite runs without Mongo.
 */
import { jest } from "@jest/globals";

const mockFindOne = jest.fn();

await jest.unstable_mockModule("../../src/DB/db.service.js", () => ({
  findOne: mockFindOne,
  // Other dbService exports aren't called by the permissions module,
  // but stub them so any future call gets a clear "not implemented"
  // signal instead of a silent undefined.
  find: jest.fn(),
  create: jest.fn(),
}));

const {
  requireOrgMembership,
  requireTaskEditAccess,
  requireTaskAssignAccess,
  requireTaskDeleteAccess,
} = await import("../../src/utils/permissions/task.permissions.js");

const ORG = "org123";
const USER = "user123";
const OTHER = "user456";
const ASSIGNEE = "user789";

beforeEach(() => mockFindOne.mockReset());

function membership(role) {
  return { _id: "m1", organizationId: ORG, userId: USER, role, isActive: true };
}

function task({ assignee, reporter }) {
  return {
    _id: "t1",
    organizationId: ORG,
    assigneeId: assignee || null,
    reporterId: reporter || null,
  };
}

describe("requireOrgMembership", () => {
  test("returns membership when user is an active member", async () => {
    mockFindOne.mockResolvedValueOnce(membership("member"));
    const m = await requireOrgMembership(ORG, USER);
    expect(m.role).toBe("member");
  });

  test("throws 403 when not a member", async () => {
    mockFindOne.mockResolvedValueOnce(null);
    await expect(requireOrgMembership(ORG, USER)).rejects.toMatchObject({
      statusCode: 403,
    });
  });
});

describe("requireTaskEditAccess", () => {
  test("assignee can edit", async () => {
    mockFindOne.mockResolvedValueOnce(membership("member"));
    const res = await requireTaskEditAccess({
      task: task({ assignee: USER, reporter: OTHER }),
      orgId: ORG,
      userId: USER,
    });
    expect(res.isAssignee).toBe(true);
  });

  test("reporter can edit", async () => {
    mockFindOne.mockResolvedValueOnce(membership("member"));
    const res = await requireTaskEditAccess({
      task: task({ assignee: OTHER, reporter: USER }),
      orgId: ORG,
      userId: USER,
    });
    expect(res.isReporter).toBe(true);
  });

  test("org admin can edit any task", async () => {
    mockFindOne.mockResolvedValueOnce(membership("admin"));
    const res = await requireTaskEditAccess({
      task: task({ assignee: OTHER, reporter: OTHER }),
      orgId: ORG,
      userId: USER,
    });
    expect(res.membership.role).toBe("admin");
  });

  test("random org member CANNOT edit someone else's task", async () => {
    mockFindOne.mockResolvedValueOnce(membership("member"));
    await expect(
      requireTaskEditAccess({
        task: task({ assignee: OTHER, reporter: ASSIGNEE }),
        orgId: ORG,
        userId: USER,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("requireTaskAssignAccess", () => {
  test("assignee CANNOT reassign themselves away", async () => {
    mockFindOne.mockResolvedValueOnce(membership("member"));
    await expect(
      requireTaskAssignAccess({
        task: task({ assignee: USER, reporter: OTHER }),
        orgId: ORG,
        userId: USER,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("reporter can reassign", async () => {
    mockFindOne.mockResolvedValueOnce(membership("member"));
    const res = await requireTaskAssignAccess({
      task: task({ assignee: ASSIGNEE, reporter: USER }),
      orgId: ORG,
      userId: USER,
    });
    expect(res.isReporter).toBe(true);
  });

  test("org owner can reassign", async () => {
    mockFindOne.mockResolvedValueOnce(membership("owner"));
    await expect(
      requireTaskAssignAccess({
        task: task({ assignee: OTHER, reporter: OTHER }),
        orgId: ORG,
        userId: USER,
      }),
    ).resolves.toBeDefined();
  });
});

describe("requireTaskDeleteAccess", () => {
  test("assignee CANNOT delete (avoids accountability dodge)", async () => {
    mockFindOne.mockResolvedValueOnce(membership("member"));
    await expect(
      requireTaskDeleteAccess({
        task: task({ assignee: USER, reporter: OTHER }),
        orgId: ORG,
        userId: USER,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("reporter can delete", async () => {
    mockFindOne.mockResolvedValueOnce(membership("member"));
    const res = await requireTaskDeleteAccess({
      task: task({ assignee: OTHER, reporter: USER }),
      orgId: ORG,
      userId: USER,
    });
    expect(res.isReporter).toBe(true);
  });

  test("org admin can delete", async () => {
    mockFindOne.mockResolvedValueOnce(membership("admin"));
    await expect(
      requireTaskDeleteAccess({
        task: task({ assignee: OTHER, reporter: OTHER }),
        orgId: ORG,
        userId: USER,
      }),
    ).resolves.toBeDefined();
  });
});
