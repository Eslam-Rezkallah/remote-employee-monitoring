# Security model

Reference for the operations + threat-model decisions in the codebase.
Keep this file accurate — every new auth/session/secret path lands here.

## Authentication

- **Bearer JWT in `Authorization` header** for every authenticated route.
- Two schemes:
  - `Bearer <token>` — user tokens (Member / Manager / Admin).
  - `System <token>` — admin/system tokens (Admin only).
- Access token TTL: 15m (default). Refresh token TTL: 7d.
- Refresh token is stored **hashed** (`sha256`) — server never persists
  the plaintext, so a DB leak doesn't grant session access.
- `changeCredentialsTime` invalidates every token issued before that
  timestamp (`iat * 1000 < changeCredentialsTime` → 401).

## Brute-force lockout

Per-user counter on the `users` collection:
- `loginFailedAttempts` — incremented on bad password, reset on success.
- `loginLockedUntil` — set when the counter crosses `LOGIN_MAX_ATTEMPTS`
  (default 5). Lockout window: `LOGIN_LOCKOUT_MS` (default 15 min).
- Locked-account responses return `429` + `Retry-After` header.

## CSRF

**This API is CSRF-resistant by design**: every authenticated route
requires `Authorization: Bearer <jwt>`. CSRF attacks work via
auto-attached **cookies**; an attacker can't read or set a custom
header from another origin (browsers block this unless CORS allows it,
and our CORS is locked to `FRONTEND_URL`).

Rules to keep this property:
- **Never** authenticate via cookie. Don't add `cookie-parser`-based
  session middleware. If you ever need cookie auth for a specific flow
  (e.g., SSR-rendered pages), add CSRF middleware (`csurf`'s successor
  `@dr.pogodin/csurf`) to those routes ONLY, and set the cookie
  `SameSite=Strict`.
- The LiveKit webhook endpoint accepts a public POST but verifies the
  request via the LiveKit SDK's signature check, so CSRF doesn't apply.

If you add a cookie session in the future, wrap those routes with:

```js
import csrf from "@dr.pogodin/csurf";
const csrfProtection = csrf({ cookie: { sameSite: "strict", secure: true } });
app.post("/cookie-route", csrfProtection, handler);
```

## Secrets

- **Credentials never live in tracked files** (see `.gitignore`).
- `.env.example` is the only env file in git; placeholders only.
- Logger redacts `apiSecret`, `*.token`, `Authorization`, `cookie`,
  LiveKit secret, etc. (see `src/utils/logger/logger.js`).
- Push notifications: `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON
  blob) is read lazily — missing means push runs in stub mode, never
  crashes boot.

## Rate limiting

- Three tiers (in `src/utils/rate-limit/limiters.js`):
  - `generalLimiter` — 200 req / 2 min, per-user
  - `authLimiter`    — 20 req / 15 min, per-IP (applied to `/auth/*`)
  - `sensitiveLimiter` — 10 req / 1 hour, per-user (for password reset etc.)
- Redis-backed when available, in-memory fallback otherwise.

## Audit trail

- Append-only `auditLog` collection — security events only.
- Canonical actions in `src/utils/audit/audit.actions.js`.
- Currently wired into: login success/failure, logout, logout-all,
  password reset complete, org create/delete, org member role change,
  org member remove, org member leave, team delete.
- Adding more is a one-liner — see `recordAudit({...})` examples in
  any wired endpoint.

## Input sanitization

- Joi validates every route body / params / query.
- Body size limit: 1 MB global, 256 KB on the LiveKit webhook.
- File uploads: MIME type whitelist via `multer` validators.

## What's NOT done yet (known gaps)

- Magic-number file validation (we trust the MIME header). Add the
  `file-type` lib if uploads need to be trusted at content level.
- Refresh token reuse detection (revoking the whole chain when a
  previously-used token shows up again). The schema supports it via
  `revokedAt`; the detection logic is missing.
- SAML / SSO.
- Encryption at rest for message bodies (currently DB-level only).

## Incident response shortcuts

- Lock out a user immediately:
  ```js
  await userModel.updateOne(
    { email: "x@y" },
    { $set: { loginLockedUntil: new Date("2099-01-01") } },
  );
  ```
- Revoke every active session for a user:
  ```js
  await refreshTokenModel.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  // and force token invalidation:
  await userModel.updateOne(
    { _id: userId },
    { $set: { changeCredentialsTime: new Date() } },
  );
  ```
- Pull the audit trail for a user:
  ```js
  db.auditlogs.find({ actorId: ObjectId("...") }).sort({ createdAt: -1 })
  ```
