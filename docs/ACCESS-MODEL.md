# Org → Team → Project → Chat — Unified Access Model

This document explains how the four core entities relate to each other,
who can do what, and how the chat rooms stay in sync with their
authoritative source-of-truth collections.

If something here disagrees with the code, the **code wins** — file a
fix against this doc.

---

## 1. The hierarchy

```
Organization                              ← top-level tenant
  │
  ├── Members  (memberModel)               role: owner | admin | member
  │     └── user joins via joinCode  →  active membership
  │
  ├── Teams                                created by org owner/admin
  │     ├── members[]    (must be org members)
  │     ├── managers[]   (subset of members)
  │     └── createdBy
  │
  ├── Projects                             created by team manager OR
  │     ├── team         (required)        org owner/admin
  │     ├── manager      (required)
  │     ├── members[]    (must be org members)
  │     └── tasks[]
  │
  └── ChatRooms                            5 distinct flavours
        ├── direct        1:1, scoped to a shared org
        ├── group         private, freeform, org-scoped
        ├── channel       open or private, scoped to org/team/project
        ├── team          one auto-room per team
        └── organization  one room per org, every member auto-joined
```

Each chat-room type carries `organizationId`, plus optionally `teamId`
or `projectId`. That breadcrumb is how access control + membership
sync find the source-of-truth collection.

---

## 2. Roles & where they're stored

| Scope | Role | Storage | What it grants |
|---|---|---|---|
| **Org** | `owner` | `memberModel.role` | full control of org, can delete org, transfer ownership |
| **Org** | `admin` | `memberModel.role` | manage members, teams, projects, org-wide chat |
| **Org** | `member` | `memberModel.role` | participate in everything they're added to |
| **Team** | `manager` | `team.managers[]` | manage team membership, create team channels, manage projects |
| **Team** | `member` | `team.members[]` | participate in team-scoped chats + projects they're added to |
| **Project** | `manager` | `project.manager` | manage project membership, status, channels |
| **Project** | `member` | `project.members[]` | participate in project + project channels |
| **Chat room** | `admin` | `room.admins[]` | rename, set privacy, add/remove members |
| **Chat room** | `member` | `room.members[]` | read/send messages, react, call |
| **System** | `Admin` | `user.role` | super-user that bypasses most org checks (rare) |

---

## 3. Access matrix (who can do what)

Legend: ✅ allowed · 🟡 allowed for own/team-scoped · ❌ forbidden

### Organization

| Action | Owner | Admin | Member | Outsider |
|---|---|---|---|---|
| Create org | — | — | — | any user |
| Delete/transfer org | ✅ | ❌ | ❌ | ❌ |
| Invite/remove members | ✅ | ✅ | ❌ | ❌ |
| Promote/demote member | ✅ | ✅ (not owner) | ❌ | ❌ |
| List org members | ✅ | ✅ | ✅ | ❌ |

### Teams

| Action | Org Owner | Org Admin | Team Manager | Team Member | Org Member (not in team) |
|---|---|---|---|---|---|
| Create team | ✅ | ✅ | ❌ | ❌ | ❌ |
| Update team name/desc | ✅ | ✅ | ✅ | ❌ | ❌ |
| Add team member | ✅ | ✅ | ✅ | ❌ | ❌ |
| Remove team member | ✅ | ✅ | ✅ | ❌ | ❌ |
| Promote/demote manager | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete team (soft) | ✅ | ✅ | ❌ | ❌ | ❌ |
| List teams | ✅ all | ✅ all | 🟡 own | 🟡 own | ❌ |

### Projects

| Action | Org Owner | Org Admin | Team Manager | Project Manager | Project Member | Org Member |
|---|---|---|---|---|---|---|
| Create project (within team) | ✅ | ✅ | ✅ | — | — | ❌ |
| Update project | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Change project status | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Transfer manager | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Add/remove project member | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Delete project (soft) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| List projects | ✅ all | ✅ all | — | 🟡 own | 🟡 own | ❌ |

### Chat rooms

| Action | Org Owner/Admin | Room Admin | Room Member | Outsider |
|---|---|---|---|---|
| Create `direct` | — | — | ✅ (with shared-org user) | ❌ |
| Create `group` | — | — | ✅ (any org member) | ❌ |
| Create `channel` (org) | ✅ | — | ❌ | ❌ |
| Create `channel` (team) | ✅ | — | ❌ (must be team manager OR org admin) | ❌ |
| Create `channel` (project) | ✅ | — | ❌ (must be project manager OR org admin) | ❌ |
| Create `team` chat | — | — | ✅ (any team member, single auto-room per team) | ❌ |
| Create `organization` chat | ✅ | — | ❌ | ❌ |
| Update room (name/privacy) | — | ✅ | ❌ | ❌ |
| Add member | — | ✅ (+ scope check) | ❌ | ❌ |
| Remove member | — | ✅ | ❌ | ❌ |
| Join public channel | — | — | ✅ (if org member) | ❌ |
| Leave room | — | — | ✅ (not direct) | ❌ |
| Delete room | — | ❌ (only createdBy) | ❌ | ❌ |
| Send message | — | ✅ | ✅ | ❌ |
| Start call | — | ✅ | ✅ | ❌ |

**Scope check** when adding a member to a chat room:
- `team` chat → new member must already be in the team
- project `channel` → new member must already be in the project
- `organization` chat → not addable manually (managed by org membership)
- `direct` → cannot add members ever
- otherwise → must be an active org member

---

## 4. The membership-sync model

Slack/Teams/WhatsApp give you implicit rooms: every team has a default
channel, every workspace has #general. **Membership of those rooms is
NOT independent** — it mirrors the team/workspace roster.

In REM, that mirroring happens through 4 functions in
[`chat.sync.service.js`](../src/modules/chatroom/service/chat.sync.service.js):

| Function | Triggered by | What it does |
|---|---|---|
| `syncTeamChatMembership(teamId)` | team add/remove member, add/remove manager | rewrites `room.members` = `team.members`, `room.admins` = `team.managers ∪ {createdBy}`, evicts removed users' sockets |
| `syncProjectChannelMembership(projectId)` | project add/remove member, transfer manager | rewrites every project-scoped channel to mirror `project.members`, forces `project.manager` into admins |
| `syncOrgChatOnMemberChange(orgId, delta)` | org join, promote, demote, remove | incremental delta on the org-wide chat (no full reconcile in the hot path because orgs may have thousands of members) |
| `reconcileOrgChatMembership(orgId)` | admin endpoint / cron | full reconcile — recovery path if the incremental drift goes wrong |

**Design rules:**
1. **Lazy**: every sync is a no-op if the chat room doesn't exist yet. The room is still created on demand; sync just keeps it correct after that.
2. **Non-throwing**: failures are LOGGED and swallowed. Adding a team member must NEVER fail because the chat sync hiccuped.
3. **Socket eviction**: removed users get kicked out of the room's socket presence so their open tabs/devices stop receiving messages immediately.

### Wiring (where the syncs fire)

```
team.service.js              → syncTeamChatMembership
  addMember, removeMember, addManager, removeManager

project.service.js           → syncProjectChannelMembership
  addMember, removeMember, transferManager

organization/member.service.js → syncOrgChatOnMemberChange
  promote, demote, remove, leave

auth/organization.service.js → syncOrgChatOnMemberChange
  org join (addUserId)
```

---

## 5. What was broken before (and is now fixed)

| Bug | Old behaviour | Fix |
|---|---|---|
| Org chat = everyone is admin | `createOrganizationChat` set `admins: memberIds` (every member) so anyone could delete the org chat | admins now = only org owners/admins |
| Team chat = everyone is admin | Same — `admins: team.members` | admins now = team managers ∪ `{createdBy}` |
| Channel with no scope | `createChannel` allowed creation without `organizationId`/`teamId`/`projectId` → orphan room | requires at least one scope |
| Team-channel auth | Any team member could create a channel for the team | only team manager OR org admin/owner |
| Cross-scope leak via addMember | Room admin could parachute any org member into a team/project chat they shouldn't see | enforces team/project membership before adding to team/project chats |
| Stale team-chat membership | Adding a member to a team did NOT add them to the existing team chat | `syncTeamChatMembership` runs on every team membership change |
| Stale project-channel membership | Same for projects | `syncProjectChannelMembership` runs on every project membership change |
| Stale org-chat membership | New org members never auto-joined the org-wide chat | `syncOrgChatOnMemberChange` runs on every org membership change |
| Pagination total wrong | `listProjects` returned `total = projects.length` (page size, not total) | uses `countDocuments` in parallel |

---

## 6. What's still missing (Slack/Teams parity gaps)

These are NOT bugs — they're feature gaps documented for the roadmap.

| Gap | Slack/Teams behaviour | REM today |
|---|---|---|
| Auto-create `#general` on org create | Always exists | created lazily, only when first requested |
| Auto-create default channel on team create | Yes | created lazily |
| Auto-create channel on project create | Yes (Teams) | not done |
| Guest accounts (single channel) | Yes | not modelled |
| Channel categories/folders | Yes | not modelled |
| Threads (replies tree) | Yes | only flat `replyTo` |
| Pinned messages | Yes | not modelled |
| Saved/bookmarked messages | Yes | not modelled |
| Slash commands | Yes | not modelled |
| Channel-level roles beyond admin/member | Yes (moderator) | only admin/member |

---

## 7. Quick reference: where the code lives

| Concern | File |
|---|---|
| Org permissions | [`src/utils/permissions/org.permissions.js`](../src/utils/permissions/org.permissions.js) |
| Org service | [`src/modules/organization/service/organization.service.js`](../src/modules/organization/service/organization.service.js) |
| Org member service | [`src/modules/organization/service/member.service.js`](../src/modules/organization/service/member.service.js) |
| Org invitations | [`src/modules/organization/service/invitation.service.js`](../src/modules/organization/service/invitation.service.js) |
| Auth org-join | [`src/modules/auth/service/organization.service.js`](../src/modules/auth/service/organization.service.js) |
| Team service | [`src/modules/team/service/team.service.js`](../src/modules/team/service/team.service.js) |
| Project service | [`src/modules/project/service/project.service.js`](../src/modules/project/service/project.service.js) |
| Chat service | [`src/modules/chatroom/service/chat.service.js`](../src/modules/chatroom/service/chat.service.js) |
| **Chat sync service** | [`src/modules/chatroom/service/chat.sync.service.js`](../src/modules/chatroom/service/chat.sync.service.js) |
| Chat models | [`src/DB/Model/chatroom.model.js`](../src/DB/Model/chatroom.model.js), [`team.model.js`](../src/DB/Model/team.model.js), [`project.model.js`](../src/DB/Model/project.model.js), [`organization.model.js`](../src/DB/Model/organization.model.js), [`member.model.js`](../src/DB/Model/member.model.js) |
