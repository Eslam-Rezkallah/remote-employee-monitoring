# Secrets rotation playbook

Run this when:
- A credential is suspected to be leaked
- A team member with prod access leaves
- A scheduled quarterly rotation
- A real secret accidentally lands in a commit

## Order matters

Always **rotate at the provider first**, then update env, then revoke
the old one. Doing it the other way locks every running instance out.

## The credentials

Each secret lives in `src/config/.env.dev` (local) and the production
secret store (Vault / Doppler / GitHub Actions secrets — pick one and
document the choice).

| Key | Where to rotate | Grace window |
|---|---|---|
| `USER_ACCESS_TOKEN`, `USER_REFRESH_TOKEN` (JWT signing) | Generate new with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | Rotating invalidates **all** sessions — coordinate with FE for a forced re-login |
| `ADMIN_ACCESS_TOKEN`, `ADMIN_REFRESH_TOKEN` | Same as above | Same |
| `EMAIL_PASSWORD` (Gmail app password) | myaccount.google.com → Security → App passwords → revoke + create | Email sends fail until new one deployed |
| `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | console.cloudinary.com → Settings → Security → Rotate | Uploads fail until new one deployed |
| `OPENAI_API_KEY` | platform.openai.com → API keys → Revoke + create new `sk-proj-*` | AI features fall back to stub if missing |
| `GOOGLE_CLIENT_ID` (OAuth) | console.cloud.google.com → Credentials → Reset secret | Google sign-in fails until updated |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | cloud.livekit.io → Settings → Keys → Regenerate | Existing JWT tokens stay valid until expiry (default 4h), new joins use new key |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | console.firebase.google.com → IAM → Service accounts → New key | Existing push attempts fail; new sends use new creds |
| `REDIS_URL` (if using managed Redis) | Provider dashboard → Rotate | Connection drops; reconnect strategy retries |
| `DB_URI` (MongoDB Atlas) | atlas.mongodb.com → Database Access → Edit user password | Connection drops; reconnect kicks in |

## Step-by-step

### 1. Pre-rotation
```powershell
# Tag current state in case you need to roll back
git tag pre-rotation-$(date +%s)
git push --tags

# Snapshot current env values somewhere safe (1Password vault, etc.)
```

### 2. Rotate at provider
Generate new credential in the provider's UI. Keep the **old one
active** for now — both should work briefly.

### 3. Update env

- **Local dev:** edit `src/config/.env.dev` directly. Do NOT commit.
- **Production:** push to the secret store (NOT git).

### 4. Deploy / restart
- `docker compose restart app`
- Verify boot logs show the feature is initialized (e.g.,
  `LiveKit webhook receiver mounted`, `firebase-admin initialised`).
- Hit `/healthz` and `/readyz`.

### 5. Revoke the old credential
Only after the new one is confirmed working. Most providers let you
revoke an old key independently.

### 6. Audit
```js
// Mongo shell: confirm no errors related to the old credential
db.auditlogs
  .find({ action: { $regex: "auth\\..+" }, outcome: "failure", createdAt: { $gt: new Date("YYYY-MM-DDTHH:MM:SSZ") } })
  .sort({ createdAt: -1 });
```

## If a secret was committed to git history

**This is destructive — coordinate with the team first.**

```powershell
# 1. Rotate at provider IMMEDIATELY (don't wait for cleanup)
# 2. Then scrub history with git filter-repo
git tag pre-scrub-$(date +%s)
git filter-repo --path src/config/.env.dev --invert-paths
git push --force-with-lease origin --all
git push --force-with-lease origin --tags

# 3. Tell everyone to re-clone
```

After this, every collaborator's local clone is broken. They need to:
```powershell
cd ..
rm -rf REM
git clone <repo-url> REM
```

## JWT signing secret rotation (special case)

Rotating `USER_ACCESS_TOKEN` / `USER_REFRESH_TOKEN` invalidates every
existing session because we sign with HS256 — there's no key ID in the
header. Options:

- **Hard cutover (current):** rotate → every user must re-login on
  next request. Acceptable for emergencies, painful for routine rotation.
- **Phased (not implemented):** issue tokens with a `kid` header,
  verify against any key in a set, deprecate old keys after the TTL
  window. Add `kid` support in `token.security.js` if you need this.

## Rotation schedule recommendation

| Secret type | Cadence |
|---|---|
| JWT signing keys | yearly (or immediately on suspected leak) |
| Provider API keys (Cloudinary, LiveKit, Firebase, OpenAI) | quarterly |
| Gmail app password | quarterly |
| Database passwords | bi-yearly |
| OAuth client secret | yearly |
