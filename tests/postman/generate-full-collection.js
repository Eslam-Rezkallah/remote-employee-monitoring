#!/usr/bin/env node
/**
 * tests/postman/generate-full-collection.js
 *
 * Produces a COMPLETE Postman collection (REM-Full.postman_collection.json)
 * with realistic test-data examples for every backend feature.
 *
 *   Usage:  node tests/postman/generate-full-collection.js
 *
 * Why a generator, not a hand-written JSON:
 *   • The collection is 80+ requests across 20+ folders — keeping the
 *     JSON in sync with code changes by hand is painful.
 *   • Helpers (`req`, `js`, `saveVar`) collapse the Postman boilerplate
 *     so each request is a single line of intent.
 *   • Test data lives once at the top of this file — easy to tune.
 *
 * Auto-saves between requests:
 *   • Auth → Login    saves accessToken, refreshToken, userId
 *   • Org  → Create   saves organizationId
 *   • Team → Create   saves teamId
 *   • Space → Create  saves spaceId
 *   • Task → Create   saves taskId
 *   • Sprint → Create saves sprintId
 *   • Chat rooms → List saves roomId
 *   • Direct create   saves directRoomId
 *   • Message → Send  saves messageId
 *   • Call → active   saves callId
 *   • WorkSession → Start saves sessionId
 *   • Reminder/Meeting/Tab/Reaction/Saved → saves their own ids
 *
 * Run the requests TOP-TO-BOTTOM the first time — every later request
 * picks up the vars set by earlier ones. After that, run any folder
 * in isolation as long as the variables it depends on are populated.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────
// Test-data examples (tune to taste — used in body templates)
// ─────────────────────────────────────────────────────────────
const data = {
  testEmail: "qa@example.com",
  testPassword: "TestPass123!",
  username: "qa_tester",
  inviteEmail: "teammate@example.com",
  orgName: "QA Acme Corp",
  orgSlug: "qa-acme",
  teamName: "Backend Squad",
  teamDescription: "Owns API + infra",
  spaceName: "Mobile App v2",
  spaceType: "Project", // Project | Team | Personal
  workflowStatuses: [
    { key: "Todo",      label: "To do",       category: "todo",        color: "gray.400",  isDefault: true },
    { key: "InProgress",label: "In progress", category: "in_progress", color: "blue.500" },
    { key: "Review",    label: "Code review", category: "in_progress", color: "amber.500" },
    { key: "Done",      label: "Done",        category: "done",        color: "green.500" },
  ],
  taskTitle: "Wire push notifications on iOS",
  taskType: "Task", // Task | Bug | Story | Epic
  taskPriority: "Medium",
  taskDescription: "FCM credentials are ready; wire the upload flow + cleanup dead tokens.",
  taskPoints: 5,
  sprintName: "Sprint 24",
  sprintGoal: "Ship the auth lockout fix and push notif framework",
  channelName: "qa-engineering",
  groupName: "QA Standup",
  messageContent: "Hello team — kicking off the QA run from Postman",
  threadReply: "Reproduced on staging — opening a ticket",
  reactionEmoji: "👍",
  reminderText: "Review PR #248 before standup",
  meetingTitle: "Sprint planning",
  meetingAgenda: "Estimate the new tickets + assign owners",
  channelTabName: "Spec Docs",
  channelTabType: "wiki", // files | wiki | tasks | pinned | app | custom
  brandingColor: "#3B82F6",
  brandingTopic: "Engineering sync — async-first decisions",
  brandingTagline: "Ship daily",
  commentBody: "Looks good — small nit on the error message wording.",
  fcmDeviceToken: "fcm-test-device-token-from-firebase-here",
  devicePlatform: "ios", // ios | android | web
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** A bash-style JS string used as Postman's pre-request / test script. */
const js = (...lines) => ({
  type: "text/javascript",
  exec: lines.flat().filter(Boolean),
});

/** Standard post-response saver — store a path from the body into env. */
const saveVar = (varName, path, label = varName) =>
  js(
    `try {`,
    `  const j = pm.response.json();`,
    `  const v = ${path};`,
    `  if (v) { pm.environment.set('${varName}', v); console.log('saved ${label}', v); }`,
    `} catch (e) { console.warn('${varName} save failed:', e.message); }`,
  );

/** Auth header pointing at {{accessToken}}. */
const authHeader = () => ({
  key: "Authorization",
  value: "Bearer {{accessToken}}",
});
const json = () => ({ key: "Content-Type", value: "application/json" });

/** Build a request item. Pass `auth: false` to skip the Bearer header. */
function req({
  name,
  method = "GET",
  path,
  query,
  body,
  auth = true,
  saveScript,
  preScript,
  description,
}) {
  const url = "{{baseUrl}}" + path;
  const headers = [];
  if (auth) headers.push(authHeader());
  if (body) headers.push(json());

  const item = {
    name,
    request: {
      method,
      header: headers,
      url: { raw: url, host: ["{{baseUrl}}"], path: pathParts(path), query: querySpec(query) },
    },
  };
  if (description) item.request.description = description;
  if (body) item.request.body = { mode: "raw", raw: JSON.stringify(body, null, 2) };
  const events = [];
  if (preScript) events.push({ listen: "prerequest", script: preScript });
  if (saveScript) events.push({ listen: "test", script: saveScript });
  if (events.length) item.event = events;
  return item;
}

function pathParts(path) {
  return path
    .replace(/^\//, "")
    .split("?")[0]
    .split("/")
    .filter(Boolean);
}

function querySpec(query) {
  if (!query) return undefined;
  return Object.entries(query).map(([key, value]) => ({
    key,
    value: String(value),
  }));
}

/** Folder with items. */
const folder = (name, items, description) => ({
  name,
  description,
  item: items,
});

// ─────────────────────────────────────────────────────────────
// Folders
// ─────────────────────────────────────────────────────────────

const folder0Health = folder("0. Health & Docs", [
  req({ name: "GET /healthz",      method: "GET", path: "/healthz", auth: false }),
  req({ name: "GET /readyz",       method: "GET", path: "/readyz",  auth: false }),
  req({ name: "GET /metrics",      method: "GET", path: "/metrics", auth: false }),
  req({ name: "GET /docs (Swagger)", method: "GET", path: "/docs",   auth: false }),
  req({ name: "GET /docs/openapi.json", method: "GET", path: "/docs/openapi.json", auth: false }),
]);

const folder1Auth = folder("1. Auth", [
  req({
    name: "POST /auth/signup",
    method: "POST",
    path: "/auth/signup",
    auth: false,
    body: {
      username: data.username,
      email: data.testEmail,
      password: data.testPassword,
      confirmPassword: data.testPassword,
    },
  }),
  req({
    name: "PATCH /auth/confirm-email (paste OTP)",
    method: "PATCH",
    path: "/auth/confirm-email",
    auth: false,
    body: { email: data.testEmail, otp: "REPLACE_OTP_FROM_INBOX" },
  }),
  req({
    name: "POST /auth/login (saves accessToken, refreshToken, userId)",
    method: "POST",
    path: "/auth/login",
    auth: false,
    body: { email: data.testEmail, password: data.testPassword },
    saveScript: js(
      `const j = pm.response.json();`,
      `if (j.data?.accessToken)  pm.environment.set('accessToken',  j.data.accessToken);`,
      `if (j.data?.refreshToken) pm.environment.set('refreshToken', j.data.refreshToken);`,
      `if (j.data?.user?._id)    pm.environment.set('userId',       j.data.user._id);`,
      `console.log('Saved session for', j.data?.user?.email);`,
    ),
  }),
  req({
    name: "POST /auth/refresh",
    method: "POST",
    path: "/auth/refresh",
    auth: false,
    body: { refreshToken: "{{refreshToken}}" },
  }),
  req({
    name: "PATCH /auth/forget-password (request OTP)",
    method: "PATCH",
    path: "/auth/forget-password",
    auth: false,
    body: { email: data.testEmail },
  }),
  req({
    name: "PATCH /auth/validate-forget-password",
    method: "PATCH",
    path: "/auth/validate-forget-password",
    auth: false,
    body: { email: data.testEmail, code: "REPLACE_OTP" },
  }),
  req({
    name: "PATCH /auth/reset-password",
    method: "PATCH",
    path: "/auth/reset-password",
    auth: false,
    body: { email: data.testEmail, password: data.testPassword },
  }),
  req({
    name: "POST /auth/logout",
    method: "POST",
    path: "/auth/logout",
    body: { refreshToken: "{{refreshToken}}" },
  }),
  req({
    name: "POST /auth/logout-all (revoke every session)",
    method: "POST",
    path: "/auth/logout-all",
  }),
]);

const folder2Org = folder("2. Organizations & Members", [
  req({
    name: "POST /org (create) → saves organizationId",
    method: "POST",
    path: "/org",
    body: { name: data.orgName, slug: data.orgSlug, logo: null },
    saveScript: saveVar("organizationId", "j.data?._id || j.data?.organization?._id", "organizationId"),
  }),
  req({ name: "GET /org/me (my orgs)", method: "GET", path: "/org/me" }),
  req({ name: "GET /org/:orgId", method: "GET", path: "/org/{{organizationId}}" }),
  req({
    name: "PATCH /org/:orgId (rename)",
    method: "PATCH",
    path: "/org/{{organizationId}}",
    body: { name: data.orgName + " (renamed)" },
  }),
  req({ name: "DELETE /org/:orgId", method: "DELETE", path: "/org/{{organizationId}}" }),
  req({ name: "GET /org/:orgId/members", method: "GET", path: "/org/{{organizationId}}/members" }),
  req({
    name: "PATCH /org/:orgId/members/:memberId/role",
    method: "PATCH",
    path: "/org/{{organizationId}}/members/{{targetUserId}}/role",
    body: { role: "admin" },
  }),
  req({
    name: "DELETE /org/:orgId/members/:memberId",
    method: "DELETE",
    path: "/org/{{organizationId}}/members/{{targetUserId}}",
  }),
  req({ name: "DELETE /org/:orgId/leave", method: "DELETE", path: "/org/{{organizationId}}/leave" }),
  req({
    name: "POST /org/:orgId/invitations (send email invite)",
    method: "POST",
    path: "/org/{{organizationId}}/invitations",
    body: { email: data.inviteEmail, role: "member" },
  }),
  req({
    name: "POST /auth/org-join (joinCode)",
    method: "POST",
    path: "/auth/org-join",
    body: { joinCode: "REPLACE_JOIN_CODE" },
  }),
  req({
    name: "GET /org/:orgId/work-sessions (admin)",
    method: "GET",
    path: "/org/{{organizationId}}/work-sessions",
  }),
  req({
    name: "GET /org/:orgId/chat-rooms",
    method: "GET",
    path: "/org/{{organizationId}}/chat-rooms",
  }),
]);

const folder3Teams = folder("3. Teams", [
  req({
    name: "POST /teams (create) → saves teamId",
    method: "POST",
    path: "/teams",
    body: {
      organizationId: "{{organizationId}}",
      name: data.teamName,
      description: data.teamDescription,
      members: [],
      managers: [],
    },
    saveScript: saveVar("teamId", "j.data?.team?._id", "teamId"),
  }),
  req({ name: "GET /teams?organizationId=", method: "GET", path: "/teams", query: { organizationId: "{{organizationId}}" } }),
  req({ name: "GET /teams/:teamId", method: "GET", path: "/teams/{{teamId}}" }),
  req({
    name: "PATCH /teams/:teamId",
    method: "PATCH",
    path: "/teams/{{teamId}}",
    body: { name: data.teamName, description: data.teamDescription + " (updated)" },
  }),
  req({
    name: "POST /teams/:teamId/members/:userId",
    method: "POST",
    path: "/teams/{{teamId}}/members/{{targetUserId}}",
  }),
  req({
    name: "POST /teams/:teamId/managers/:userId (promote)",
    method: "POST",
    path: "/teams/{{teamId}}/managers/{{targetUserId}}",
  }),
  req({
    name: "DELETE /teams/:teamId/managers/:userId (demote)",
    method: "DELETE",
    path: "/teams/{{teamId}}/managers/{{targetUserId}}",
  }),
  req({
    name: "DELETE /teams/:teamId/members/:userId",
    method: "DELETE",
    path: "/teams/{{teamId}}/members/{{targetUserId}}",
  }),
  req({ name: "DELETE /teams/:teamId", method: "DELETE", path: "/teams/{{teamId}}" }),
]);

const folder4Spaces = folder("4. Spaces & Workflows", [
  req({
    name: "POST /org/:orgId/spaces → saves spaceId",
    method: "POST",
    path: "/org/{{organizationId}}/spaces",
    body: { name: data.spaceName, type: data.spaceType, icon: "🚀" },
    saveScript: saveVar("spaceId", "j.data?._id", "spaceId"),
  }),
  req({ name: "GET /org/:orgId/spaces", method: "GET", path: "/org/{{organizationId}}/spaces" }),
  req({
    name: "GET /org/:orgId/spaces/search?q=",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/search",
    query: { q: "mobile" },
  }),
  req({ name: "GET /org/:orgId/spaces/:spaceId", method: "GET", path: "/org/{{organizationId}}/spaces/{{spaceId}}" }),
  req({
    name: "PATCH /org/:orgId/spaces/:spaceId (rename)",
    method: "PATCH",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}",
    body: { name: data.spaceName + " v3", icon: "📱" },
  }),
  req({ name: "DELETE /org/:orgId/spaces/:spaceId", method: "DELETE", path: "/org/{{organizationId}}/spaces/{{spaceId}}" }),
  req({
    name: "GET /org/:orgId/spaces/:spaceId/views",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/views",
  }),
  req({
    name: "GET /org/:orgId/spaces/:spaceId/summary/status",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/summary/status",
  }),
  req({
    name: "GET /org/:orgId/spaces/:spaceId/summary/priority",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/summary/priority",
  }),
  req({
    name: "GET /org/:orgId/spaces/:spaceId/summary/workload",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/summary/workload",
  }),
  req({
    name: "GET /org/:orgId/spaces/:spaceId/calendar",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/calendar",
  }),
  req({
    name: "GET /org/:orgId/spaces/:spaceId/timeline",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/timeline",
  }),
  req({
    name: "GET workflow",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/workflow",
  }),
  req({
    name: "POST workflow (upsert custom Kanban)",
    method: "POST",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/workflow",
    body: { name: "Engineering flow", statuses: data.workflowStatuses },
  }),
  req({
    name: "DELETE workflow (revert default)",
    method: "DELETE",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/workflow",
  }),
]);

const folder5Tasks = folder("5. Tasks", [
  req({
    name: "POST create task → saves taskId",
    method: "POST",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks",
    body: {
      title: data.taskTitle,
      description: data.taskDescription,
      type: data.taskType,
      priority: data.taskPriority,
      points: data.taskPoints,
      labels: ["mobile", "push"],
    },
    saveScript: saveVar("taskId", "j.data?._id", "taskId"),
  }),
  req({
    name: "GET list",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks",
    query: { page: 1, limit: 30 },
  }),
  req({
    name: "GET backlog",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/backlog",
  }),
  req({
    name: "GET single task",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}",
  }),
  req({
    name: "PATCH update task fields",
    method: "PATCH",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}",
    body: { priority: "High", labels: ["mobile", "push", "p0"] },
  }),
  req({
    name: "PATCH status (Kanban)",
    method: "PATCH",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}/status",
    body: { status: "InProgress" },
  }),
  req({
    name: "PATCH assign",
    method: "PATCH",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}/assign",
    body: { assigneeId: "{{targetUserId}}" },
  }),
  req({
    name: "PATCH unassign",
    method: "PATCH",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}/assign",
    body: { assigneeId: null },
  }),
  req({
    name: "PATCH due date",
    method: "PATCH",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}/due-date",
    body: { dueDate: new Date(Date.now() + 7 * 86400_000).toISOString() },
  }),
  req({
    name: "GET due-dates calendar",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/due-dates",
  }),
  req({
    name: "POST dependency (blockedBy)",
    method: "POST",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}/dependencies",
    body: { blockerId: "{{blockerTaskId}}" },
  }),
  req({
    name: "GET dependencies",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}/dependencies",
  }),
  req({
    name: "GET children (Epic tree)",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}/children",
  }),
  req({
    name: "DELETE soft",
    method: "DELETE",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/tasks/{{taskId}}",
  }),
]);

const folder6Sprints = folder("6. Sprints", [
  req({
    name: "POST create sprint → saves sprintId",
    method: "POST",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/sprints",
    body: {
      name: data.sprintName,
      goal: data.sprintGoal,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 14 * 86400_000).toISOString(),
    },
    saveScript: saveVar("sprintId", "j.data?._id", "sprintId"),
  }),
  req({
    name: "GET list sprints",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/sprints",
  }),
  req({
    name: "GET single sprint",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/sprints/{{sprintId}}",
  }),
  req({
    name: "PATCH update sprint (name/goal/dates)",
    method: "PATCH",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/sprints/{{sprintId}}",
    body: { goal: data.sprintGoal + " — updated" },
  }),
  req({
    name: "PATCH sprint status (Active triggers notifications)",
    method: "PATCH",
    path: "/sprints/{{sprintId}}/status",
    body: { status: "Active" },
  }),
  req({
    name: "DELETE sprint (soft)",
    method: "DELETE",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/sprints/{{sprintId}}",
  }),
  req({
    name: "GET burndown",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/reports/sprints/{{sprintId}}/burndown",
  }),
  req({
    name: "GET burnup",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/reports/sprints/{{sprintId}}/burnup",
  }),
  req({
    name: "GET cumulative flow",
    method: "GET",
    path: "/org/{{organizationId}}/spaces/{{spaceId}}/reports/sprints/{{sprintId}}/cumulative-flow",
  }),
]);

const folder7Comments = folder("7. Comments", [
  req({
    name: "POST comment",
    method: "POST",
    path: "/tasks/{{taskId}}/comments",
    body: { content: data.commentBody + ` cc @${data.username}` },
    saveScript: saveVar("commentId", "j.data?._id || j.data?.comment?._id", "commentId"),
  }),
  req({ name: "GET list", method: "GET", path: "/tasks/{{taskId}}/comments" }),
  req({
    name: "PATCH edit",
    method: "PATCH",
    path: "/tasks/{{taskId}}/comments/{{commentId}}",
    body: { content: data.commentBody + " (edited)" },
  }),
  req({ name: "DELETE", method: "DELETE", path: "/tasks/{{taskId}}/comments/{{commentId}}" }),
]);

const folder8Rooms = folder("8. Chat Rooms", [
  req({
    name: "GET /chat/rooms → saves roomId (first one)",
    method: "GET",
    path: "/chat/rooms",
    saveScript: js(
      `try {`,
      `  const j = pm.response.json();`,
      `  const arr = j.data?.rooms || j.data?.items || j.data || [];`,
      `  if (Array.isArray(arr) && arr.length) pm.environment.set('roomId', arr[0]._id);`,
      `} catch {}`,
    ),
  }),
  req({ name: "GET unread counts", method: "GET", path: "/chat/rooms/unread-counts" }),
  req({
    name: "POST /chat/rooms/direct → saves directRoomId",
    method: "POST",
    path: "/chat/rooms/direct",
    body: { targetUserId: "{{targetUserId}}" },
    saveScript: saveVar("directRoomId", "j.data?.room?._id || j.data?._id", "directRoomId"),
  }),
  req({
    name: "POST /chat/rooms/group",
    method: "POST",
    path: "/chat/rooms/group",
    body: {
      name: data.groupName,
      organizationId: "{{organizationId}}",
      memberIds: ["{{targetUserId}}"],
    },
    saveScript: saveVar("groupRoomId", "j.data?.room?._id || j.data?._id", "groupRoomId"),
  }),
  req({
    name: "POST /chat/rooms/channel",
    method: "POST",
    path: "/chat/rooms/channel",
    body: {
      name: data.channelName,
      organizationId: "{{organizationId}}",
      teamId: "{{teamId}}",
      isPrivate: false,
    },
    saveScript: saveVar("channelRoomId", "j.data?.room?._id || j.data?._id", "channelRoomId"),
  }),
  req({
    name: "POST /chat/rooms/team",
    method: "POST",
    path: "/chat/rooms/team",
    body: { teamId: "{{teamId}}" },
  }),
  req({
    name: "POST /chat/rooms/organization",
    method: "POST",
    path: "/chat/rooms/organization",
    body: { organizationId: "{{organizationId}}" },
  }),
  req({ name: "GET /chat/rooms/:roomId", method: "GET", path: "/chat/rooms/{{roomId}}" }),
  req({
    name: "PATCH /chat/rooms/:roomId (branding)",
    method: "PATCH",
    path: "/chat/rooms/{{roomId}}",
    body: {
      branding: {
        color: data.brandingColor,
        topic: data.brandingTopic,
        tagline: data.brandingTagline,
      },
    },
  }),
  req({
    name: "POST /chat/rooms/:roomId/join",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/join",
  }),
  req({
    name: "DELETE /chat/rooms/:roomId/leave",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/leave",
  }),
  req({
    name: "POST add member",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/members/{{targetUserId}}",
  }),
  req({
    name: "DELETE remove member",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/members/{{targetUserId}}",
  }),
]);

const folder9Messages = folder("9. Messages", [
  req({
    name: "POST send → saves messageId",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages",
    body: { content: data.messageContent, messageType: "text" },
    saveScript: saveVar("messageId", "j.data?.message?._id || j.data?._id", "messageId"),
  }),
  req({
    name: "POST send with mention",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages",
    body: { content: `Hey @${data.username} could you take a look?`, messageType: "text" },
  }),
  req({
    name: "POST slash command /shrug",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages",
    body: { content: "/shrug honestly", messageType: "text" },
  }),
  req({
    name: "POST slash /remind in 1m",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages",
    body: { content: "/remind in 1m " + data.reminderText, messageType: "text" },
  }),
  req({
    name: "GET list",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/messages",
    query: { page: 1, limit: 30 },
  }),
  req({
    name: "GET search ?q=",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/messages/search",
    query: { q: "hello" },
  }),
  req({
    name: "PATCH edit (within 1h window)",
    method: "PATCH",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}",
    body: { content: data.messageContent + " (edited)" },
  }),
  req({
    name: "DELETE for me",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}",
    query: { deleteType: "me" },
  }),
  req({
    name: "DELETE for everyone",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}",
    query: { deleteType: "everyone" },
  }),
  req({
    name: "POST forward",
    method: "POST",
    path: "/chat/rooms/{{groupRoomId}}/messages/forward",
    body: { sourceMessageId: "{{messageId}}" },
  }),
  req({
    name: "PATCH mark seen (receipt)",
    method: "PATCH",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/seen",
  }),
  req({
    name: "PATCH mark delivered",
    method: "PATCH",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/delivered",
  }),
]);

const folder10Threads = folder("10. Threads, Pins, Saves & Inbox", [
  req({
    name: "POST reply (creates thread)",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages",
    body: { content: data.threadReply, replyTo: "{{messageId}}" },
  }),
  req({
    name: "GET thread",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/thread",
  }),
  req({
    name: "POST pin",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/pin",
  }),
  req({
    name: "GET pinned",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/messages/pinned",
  }),
  req({
    name: "DELETE unpin",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/pin",
  }),
  req({
    name: "POST save (bookmark)",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/save",
    body: { note: "review with team Monday" },
  }),
  req({
    name: "GET /me/saved-messages",
    method: "GET",
    path: "/me/saved-messages",
  }),
  req({
    name: "DELETE unsave",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/save",
  }),
  req({ name: "GET /me/mentions", method: "GET", path: "/me/mentions" }),
]);

const folder11Reactions = folder("11. Reactions", [
  req({
    name: "POST add reaction 👍",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/reactions",
    body: { reaction: data.reactionEmoji },
  }),
  req({
    name: "DELETE my reaction",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/messages/{{messageId}}/reactions",
  }),
]);

const folder12Scheduled = folder("12. Scheduled Messages & Reminders", [
  req({
    name: "POST schedule message",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/messages/schedule",
    body: {
      content: "Scheduled QA message",
      sendAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    },
    saveScript: saveVar("scheduledId", "j.data?._id", "scheduledId"),
  }),
  req({
    name: "GET my scheduled in room",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/messages/scheduled",
  }),
  req({
    name: "DELETE cancel scheduled",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/messages/scheduled/{{scheduledId}}",
  }),
  req({
    name: "POST /me/reminders",
    method: "POST",
    path: "/me/reminders",
    body: {
      text: data.reminderText,
      triggerAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    },
    saveScript: saveVar("reminderId", "j.data?._id", "reminderId"),
  }),
  req({ name: "GET /me/reminders", method: "GET", path: "/me/reminders" }),
  req({
    name: "DELETE /me/reminders/:id",
    method: "DELETE",
    path: "/me/reminders/{{reminderId}}",
  }),
]);

const folder13ChannelTabs = folder("13. Channel Tabs", [
  req({
    name: "POST create tab",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/tabs",
    body: { name: data.channelTabName, type: data.channelTabType, config: {}, order: 0 },
    saveScript: saveVar("tabId", "j.data?._id", "tabId"),
  }),
  req({ name: "GET list tabs", method: "GET", path: "/chat/rooms/{{roomId}}/tabs" }),
  req({
    name: "PATCH update tab",
    method: "PATCH",
    path: "/chat/rooms/{{roomId}}/tabs/{{tabId}}",
    body: { name: data.channelTabName + " v2" },
  }),
  req({
    name: "DELETE tab",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/tabs/{{tabId}}",
  }),
]);

const folder14Calls = folder("14. Calls (REST)", [
  req({
    name: "GET history",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/calls",
    query: { page: 1, limit: 20 },
  }),
  req({
    name: "GET active (saves callId)",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/calls/active",
    saveScript: js(
      `try {`,
      `  const j = pm.response.json();`,
      `  if (j.data?.call?._id) pm.environment.set('callId', j.data.call._id);`,
      `} catch {}`,
    ),
  }),
  req({
    name: "GET single call",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/calls/{{callId}}",
  }),
  req({
    name: "POST LiveKit join token",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/calls/{{callId}}/livekit-token",
    body: { deviceId: "postman-desktop-1" },
  }),
  req({
    name: "POST start recording",
    method: "POST",
    path: "/chat/rooms/{{roomId}}/calls/{{callId}}/recording",
  }),
  req({
    name: "DELETE stop recording",
    method: "DELETE",
    path: "/chat/rooms/{{roomId}}/calls/{{callId}}/recording",
  }),
  req({
    name: "GET recording download URL",
    method: "GET",
    path: "/chat/rooms/{{roomId}}/calls/{{callId}}/recording/download",
  }),
]);

const folder15Meetings = folder("15. Meetings", [
  req({
    name: "POST schedule meeting → saves meetingId",
    method: "POST",
    path: "/meetings",
    body: {
      organizationId: "{{organizationId}}",
      title: data.meetingTitle,
      agenda: data.meetingAgenda,
      startTime: new Date(Date.now() + 30 * 60_000).toISOString(),
      endTime: new Date(Date.now() + 90 * 60_000).toISOString(),
      invitees: [{ userId: "{{targetUserId}}", isRequired: true }],
    },
    saveScript: saveVar("meetingId", "j.data?._id", "meetingId"),
  }),
  req({ name: "GET /meetings (my upcoming)", method: "GET", path: "/meetings" }),
  req({
    name: "PATCH RSVP",
    method: "PATCH",
    path: "/meetings/{{meetingId}}/rsvp",
    body: { status: "accepted" },
  }),
  req({
    name: "DELETE cancel meeting",
    method: "DELETE",
    path: "/meetings/{{meetingId}}",
  }),
]);

const folder16Notifications = folder("16. Notifications", [
  req({ name: "GET inbox", method: "GET", path: "/notifications" }),
  req({
    name: "PATCH /notifications/:id/read",
    method: "PATCH",
    path: "/notifications/{{notificationId}}/read",
  }),
  req({ name: "PATCH /notifications/read-all", method: "PATCH", path: "/notifications/read-all" }),
  req({ name: "GET /notifications/preferences", method: "GET", path: "/notifications/preferences" }),
  req({
    name: "PATCH /notifications/preferences",
    method: "PATCH",
    path: "/notifications/preferences",
    body: {
      global: { inApp: true, push: true, email: false },
      byType: { task_assigned: { push: true, email: true } },
    },
  }),
]);

const folder17Devices = folder("17. Push Devices", [
  req({
    name: "POST register device",
    method: "POST",
    path: "/me/devices",
    body: { token: data.fcmDeviceToken, platform: data.devicePlatform },
  }),
  req({ name: "GET my devices", method: "GET", path: "/me/devices" }),
  req({
    name: "DELETE device (unregister)",
    method: "DELETE",
    path: "/me/devices/{{deviceTokenId}}",
  }),
]);

const folder18WorkSession = folder("18. Work Sessions (Time Tracking)", [
  req({
    name: "POST start → saves sessionId",
    method: "POST",
    path: "/work-session/start",
    body: { orgId: "{{organizationId}}", note: "Postman QA session" },
    saveScript: saveVar("sessionId", "j.data?._id", "sessionId"),
  }),
  req({
    name: "POST activity (heartbeat — keeps user 'active')",
    method: "POST",
    path: "/work-session/activity",
    body: { orgId: "{{organizationId}}", type: "keystroke" },
  }),
  req({
    name: "POST pause",
    method: "POST",
    path: "/work-session/pause",
    body: { orgId: "{{organizationId}}", note: "lunch" },
  }),
  req({
    name: "POST resume",
    method: "POST",
    path: "/work-session/resume",
    body: { orgId: "{{organizationId}}" },
  }),
  req({
    name: "POST stop",
    method: "POST",
    path: "/work-session/stop",
    body: { orgId: "{{organizationId}}", note: "EOD" },
  }),
  req({
    name: "GET my sessions",
    method: "GET",
    path: "/work-session/me",
    query: { orgId: "{{organizationId}}" },
  }),
]);

const folder19Screenshots = folder("19. Screenshots", [
  req({
    name: "POST upload screenshot URL",
    method: "POST",
    path: "/work-session/{{sessionId}}/screenshots",
    body: {
      imageUrl: "https://res.cloudinary.com/example/qa-screenshot.png",
      capturedAt: new Date().toISOString(),
    },
    saveScript: saveVar("screenshotId", "j.data?._id", "screenshotId"),
  }),
  req({
    name: "GET session screenshots",
    method: "GET",
    path: "/work-session/{{sessionId}}/screenshots",
    query: { page: 1, limit: 50 },
  }),
  req({
    name: "DELETE screenshot",
    method: "DELETE",
    path: "/work-session/screenshots/{{screenshotId}}",
  }),
]);

const folder20Activity = folder("20. Activity Events (Apps / Web / Input)", [
  req({
    name: "POST batch upload (keystroke + mouse + app + website)",
    method: "POST",
    path: "/work-session/{{sessionId}}/activity-events",
    body: {
      events: [
        {
          type: "keystroke",
          bucketAt: new Date().toISOString(),
          payload: { count: 142 },
        },
        {
          type: "mouse",
          bucketAt: new Date().toISOString(),
          payload: { clicks: 23, scrolls: 7, distance: 1840 },
        },
        {
          type: "app_usage",
          bucketAt: new Date().toISOString(),
          startTime: new Date(Date.now() - 15 * 60_000).toISOString(),
          endTime: new Date().toISOString(),
          payload: { appName: "VS Code", windowTitle: "REM — backend" },
        },
        {
          type: "website_visit",
          bucketAt: new Date().toISOString(),
          startTime: new Date(Date.now() - 5 * 60_000).toISOString(),
          endTime: new Date().toISOString(),
          payload: {
            domain: "github.com",
            url: "https://github.com/org/repo/pull/248",
            productive: true,
          },
        },
      ],
    },
  }),
  req({
    name: "GET my activity events",
    method: "GET",
    path: "/work-session/activity-events",
    query: {
      orgId: "{{organizationId}}",
      from: new Date(Date.now() - 7 * 86400_000).toISOString(),
      to: new Date().toISOString(),
    },
  }),
  req({
    name: "GET activity for another user (admin)",
    method: "GET",
    path: "/work-session/activity-events",
    query: {
      orgId: "{{organizationId}}",
      userId: "{{targetUserId}}",
      type: "app_usage",
    },
  }),
]);

const folder21Dashboards = folder("21. Productivity Dashboards", [
  req({
    name: "GET /dashboards/me",
    method: "GET",
    path: "/dashboards/me",
    query: {
      orgId: "{{organizationId}}",
      from: new Date(Date.now() - 7 * 86400_000).toISOString(),
      to: new Date().toISOString(),
    },
  }),
  req({
    name: "GET /dashboards/org/:orgId (admin matrix)",
    method: "GET",
    path: "/dashboards/org/{{organizationId}}",
    query: {
      from: new Date(Date.now() - 30 * 86400_000).toISOString(),
      to: new Date().toISOString(),
    },
  }),
  req({
    name: "GET /dashboards/team/:teamId",
    method: "GET",
    path: "/dashboards/team/{{teamId}}",
  }),
]);

const folder22Stars = folder("22. Stars (favorites)", [
  req({
    name: "POST star task",
    method: "POST",
    path: "/stars",
    body: { entityType: "Task", entityId: "{{taskId}}" },
  }),
  req({ name: "GET my stars", method: "GET", path: "/stars" }),
  req({
    name: "DELETE unstar",
    method: "DELETE",
    path: "/stars",
    query: { entityType: "Task", entityId: "{{taskId}}" },
  }),
]);

const folder23Webhooks = folder("23. Outbound Webhooks (consumer side)", [
  req({
    name: "POST subscribe to events",
    method: "POST",
    path: "/org/{{organizationId}}/webhooks",
    body: {
      url: "https://example.com/hooks/rem",
      events: ["task.created", "task.status_changed", "chat.message.sent"],
    },
    saveScript: saveVar("webhookId", "j.data?._id", "webhookId"),
  }),
  req({
    name: "GET subscriptions",
    method: "GET",
    path: "/org/{{organizationId}}/webhooks",
  }),
  req({
    name: "POST rotate secret",
    method: "POST",
    path: "/org/{{organizationId}}/webhooks/{{webhookId}}/rotate",
  }),
  req({
    name: "DELETE subscription",
    method: "DELETE",
    path: "/org/{{organizationId}}/webhooks/{{webhookId}}",
  }),
]);

const folder24MeProfile = folder("24. Me / Profile / Stats", [
  req({ name: "GET /me/tasks/assigned",  method: "GET", path: "/me/tasks/assigned",  query: { orgId: "{{organizationId}}" } }),
  req({ name: "GET /me/tasks/worked-on", method: "GET", path: "/me/tasks/worked-on", query: { orgId: "{{organizationId}}" } }),
  req({ name: "GET /me/tasks/team",      method: "GET", path: "/me/tasks/team",      query: { orgId: "{{organizationId}}" } }),
  req({ name: "GET /me/for-you",         method: "GET", path: "/me/for-you",         query: { orgId: "{{organizationId}}" } }),
]);

// ─────────────────────────────────────────────────────────────
// Compose collection
// ─────────────────────────────────────────────────────────────

const collection = {
  info: {
    _postman_id: "rem-full-2026-06",
    name: "REM — Full Backend",
    description:
      "Complete coverage of the REM backend.\n\n" +
      "Test-data examples baked into every request body. Auto-saves chain " +
      "IDs across folders so a top-to-bottom run requires only:\n" +
      "  • testEmail, testPassword, targetUserId set in the env\n" +
      "Login auto-saves accessToken / refreshToken / userId; later folders " +
      "save organizationId, teamId, spaceId, taskId, sprintId, roomId, " +
      "messageId, callId, sessionId, etc.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  item: [
    folder0Health,
    folder1Auth,
    folder2Org,
    folder3Teams,
    folder4Spaces,
    folder5Tasks,
    folder6Sprints,
    folder7Comments,
    folder8Rooms,
    folder9Messages,
    folder10Threads,
    folder11Reactions,
    folder12Scheduled,
    folder13ChannelTabs,
    folder14Calls,
    folder15Meetings,
    folder16Notifications,
    folder17Devices,
    folder18WorkSession,
    folder19Screenshots,
    folder20Activity,
    folder21Dashboards,
    folder22Stars,
    folder23Webhooks,
    folder24MeProfile,
  ],
};

const environment = {
  id: "rem-env-2026-06",
  name: "REM Local",
  _postman_variable_scope: "environment",
  values: [
    { key: "baseUrl",         value: "http://localhost:3000", enabled: true },
    { key: "testEmail",       value: data.testEmail,          enabled: true },
    { key: "testPassword",    value: data.testPassword,       enabled: true, type: "secret" },
    { key: "targetUserId",    value: "",                      enabled: true, description: "Second test user — set before running team/chat tests" },
    { key: "accessToken",     value: "",                      enabled: true, type: "secret" },
    { key: "refreshToken",    value: "",                      enabled: true, type: "secret" },
    { key: "userId",          value: "",                      enabled: true },
    { key: "organizationId",  value: "",                      enabled: true },
    { key: "teamId",          value: "",                      enabled: true },
    { key: "spaceId",         value: "",                      enabled: true },
    { key: "taskId",          value: "",                      enabled: true },
    { key: "blockerTaskId",   value: "",                      enabled: true, description: "Set when testing dependencies" },
    { key: "sprintId",        value: "",                      enabled: true },
    { key: "commentId",       value: "",                      enabled: true },
    { key: "roomId",          value: "",                      enabled: true },
    { key: "directRoomId",    value: "",                      enabled: true },
    { key: "groupRoomId",     value: "",                      enabled: true },
    { key: "channelRoomId",   value: "",                      enabled: true },
    { key: "messageId",       value: "",                      enabled: true },
    { key: "scheduledId",     value: "",                      enabled: true },
    { key: "reminderId",      value: "",                      enabled: true },
    { key: "tabId",           value: "",                      enabled: true },
    { key: "callId",          value: "",                      enabled: true },
    { key: "meetingId",       value: "",                      enabled: true },
    { key: "notificationId",  value: "",                      enabled: true },
    { key: "deviceTokenId",   value: "",                      enabled: true },
    { key: "sessionId",       value: "",                      enabled: true },
    { key: "screenshotId",    value: "",                      enabled: true },
    { key: "webhookId",       value: "",                      enabled: true },
  ],
};

const outCollection = join(__dirname, "REM-Full.postman_collection.json");
const outEnv = join(__dirname, "REM-Full.postman_environment.json");

writeFileSync(outCollection, JSON.stringify(collection, null, 2), "utf8");
writeFileSync(outEnv, JSON.stringify(environment, null, 2), "utf8");

let count = 0;
for (const f of collection.item) count += f.item.length;

console.log("✓ Wrote", outCollection);
console.log("✓ Wrote", outEnv);
console.log(`  ${collection.item.length} folders, ${count} requests, ${environment.values.length} env vars`);
