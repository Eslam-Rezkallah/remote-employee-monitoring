# Chat & Calls QA Harness

Minimal frontend to manually verify chat + calls features end-to-end.
**Function over appearance** — every panel renders request payload,
response body, status, latency, and headers.

## Run

```powershell
npm run dev
```

Then open in browser:

```
http://localhost:3000/qa/
```

Trailing slash matters (Express static serving).

## Pages

| Tab | What it covers | Verifies |
|---|---|---|
| **1. Auth** | login, signup, confirm-email, forgot/reset, health | session + tokens saved to localStorage |
| **2. Rooms** | list rooms, branding, direct, group, channel, join/leave, add/remove member | room creation + membership |
| **3. Messages** | send, list, search, edit, delete, forward, reactions, threads, mentions inbox, pin, save, notifications | every REST chat endpoint |
| **4. Calls** | history, active, LiveKit token, recording start/stop/download | call lifecycle REST |
| **5. Realtime** ⚡ | `/chat` + `/call` namespaces — connect, join room, emit any event, watch incoming events + notifications live | sockets + realtime fan-out |

## Recommended flow (2-user manual test)

1. Open the harness in two browsers — chrome window + incognito.
2. In window 1, log in as user A. In window 2, log in as user B.
3. Both go to **5. Realtime** and click **Connect** for `/chat`.
4. User A in **2. Rooms** creates a direct room → paste `roomId` into BOTH windows on the Realtime tab and click **Join room** on `/chat`.
5. User A on **3. Messages** sends a message → user B should see a `receive_message` event in their `/chat` log (and a `notification` event in the inbox).
6. User B reacts → user A sees `reaction_added`.
7. User A starts a call from **5. Realtime** with preset `call:initiate (video)` → user B's `/call` log shows `call:incoming`.
8. User B emits `call:accept` → both get `call:accepted`.
9. Try `call:raise-hand`, `call:chat:send`, `call:mention`.
10. User A emits `call:end` → both see `call:ended`.

## Storage

- `localStorage` keys: `rem.qa.baseUrl`, `rem.qa.accessToken`, `rem.qa.refreshToken`, `rem.qa.user`.
- Header chip in the top right shows the current user; Logout button clears storage + disconnects all sockets.

## Folder structure

```
tests/qa-frontend/
├── index.html          ← shell + nav
├── app.js              ← lazy page loader + nav wiring
├── api/
│   ├── client.js       ← reusable REST wrapper (api(path, opts))
│   └── socket-client.js ← reusable Socket.IO wrapper (connect/disconnect/emit/onAny)
├── components/
│   └── ui.js           ← card, row, input, button, runWithPanel, renderResult
├── pages/
│   ├── auth.js
│   ├── rooms.js
│   ├── messages.js
│   ├── calls.js
│   └── socket.js
└── docs/
    └── README.md       ← this file
```

## Manual QA checklist

Tick each row when you've verified the behaviour in the harness AND
seen the expected event in the Realtime tab (where applicable).

### Auth
- [ ] Login returns 200 + access/refresh tokens
- [ ] Wrong password returns 401 (5 attempts → 429 with `Retry-After`)
- [ ] Logout revokes refresh token

### Rooms
- [ ] List my rooms returns array
- [ ] Direct between same-org users → 201 (idempotent — second call returns existing)
- [ ] Group creation 201
- [ ] Channel creation requires admin/owner role
- [ ] PATCH branding persists color/topic/tagline
- [ ] Add/remove member updates the room.members array

### Messages
- [ ] Send → 201, returns the populated message
- [ ] List returns messages with `readReceipt: { totalRecipients, readCount, isFullyRead, readByMe }`
- [ ] Edit before 1h → 200, after 1h → 403
- [ ] Delete "me" hides only for self; "everyone" updates `deletedForEveryone`
- [ ] Forward copies content + sets `forwardedFrom`
- [ ] Search returns text-indexed hits
- [ ] Reaction add then list shows count
- [ ] Reply with `replyTo` increments parent's `replyCount`
- [ ] Pin → `pinnedBy/pinnedAt` set; appears in `/pinned`
- [ ] Save → appears in `/me/saved-messages`; second save is idempotent
- [ ] `@username` → mentioned user receives `notification` event + appears in `/me/mentions`

### Calls (REST)
- [ ] Call history returns past calls (excluding `ringing`)
- [ ] Active call lookup returns current ringing/active call
- [ ] LiveKit token returns `url`, `token`, `identity` (`<userId>__<deviceId>`), `room` (`call_<callId>`)
- [ ] Recording start → call doc gets `recording.egressId` + `status: pending/active`
- [ ] Recording stop → status transitions to `ended`
- [ ] Download URL returns presigned URL (or stub passthrough)

### Realtime
- [ ] `/chat` connects → `connect` event in log
- [ ] Join room → `room_joined` event echoes back
- [ ] Typing event broadcasts to other tabs in room
- [ ] `send_message` → other tab sees `receive_message`
- [ ] `message_seen` → sender sees `messages_seen`
- [ ] `add_reaction` → broadcast to room
- [ ] `/call` connects → `call:initiate` rings the other tab via `call:incoming`
- [ ] `call:accept` flips state, emits `call:accepted` to caller
- [ ] `call:raise-hand` → all in-call sockets see `call:hand-raised`
- [ ] `call:chat:send` → ephemeral chat broadcasts
- [ ] `call:mention` → target user gets direct `call:mentioned`
- [ ] `call:end` → all see `call:ended`

### Notifications
- [ ] In-app notification fires on mention (Realtime tab → notifications column)
- [ ] GET /notifications returns persisted entries

## Postman Collection

The same surface area is exported as a Postman collection at
[`tests/postman/REM-Chat-Calls.postman_collection.json`](../../postman/REM-Chat-Calls.postman_collection.json)
+ environment [`REM-Local.postman_environment.json`](../../postman/REM-Local.postman_environment.json).

Variables auto-populated by test scripts:
- `accessToken` / `refreshToken` / `userId` — saved by Auth → Login
- `roomId` — saved by Chat rooms → List
- `messageId` — saved by Messages → Send
- `callId` — saved by Calls → Get active

Set manually:
- `testEmail`, `testPassword`
- `organizationId`, `targetUserId`

Folders:
- **0. Health** — `/healthz`, `/readyz`
- **1. Auth** — signup, confirm, login (saves tokens), refresh, logout
- **2. Chat rooms** — list, unread counts, direct, group, channel, get, branding
- **3. Messages** — send (saves messageId), list, search, edit, delete (me/everyone), forward
- **4. Receipts / Reactions / Threads / Pin / Save** — every per-message endpoint + mentions inbox + notifications
- **5. Calls (REST)** — history, active (saves callId), detail, LiveKit token, recording start/stop/download
