# Pre-Push Cleanup Checklist

> Run these BEFORE pushing to GitHub. The repo currently tracks 19,007
> files of `node_modules` that shouldn't be there.

## 🔴 1) Remove `node_modules` from git tracking (CRITICAL)

The `.gitignore` already excludes `node_modules/`, but the folder was
committed earlier so git keeps tracking it. Untrack it once:

```powershell
git rm -r --cached node_modules
git commit -m "chore: stop tracking node_modules"
```

**Result**: ~19,007 files removed from the repo. Push will be 100× smaller.

## 🟡 2) Decide on `FE_Angular/` (optional but recommended)

You have **two frontend skeletons** in the root:

| Folder | Tracked files | What it is | Recommendation |
|---|---|---|---|
| `FE/` | 8 | Vanilla HTML + JS — login.html + index.html | Keep if you use it, delete otherwise |
| `FE_Angular/` | 25 | Angular project shell (no node_modules tracked) | **Delete** if you've decided on a different FE stack |

If you don't need them:

```powershell
# Optional — delete both
git rm -r --cached FE FE_Angular
rm -rf FE FE_Angular
git commit -m "chore: remove unused FE skeletons"
```

If you keep them but they have local `node_modules/`:

```powershell
# Re-run the .gitignore rule against them
git rm -r --cached FE/node_modules FE_Angular/node_modules 2>$null
```

## 🟢 3) Verify nothing sensitive is about to be pushed

```powershell
# Should output ONLY src/config/.env.example (the template)
git ls-files | Select-String "\.env"

# Should be empty
git ls-files | Select-String "credentials|secret|\.pem$|\.key$"
```

If anything shows up beyond `.env.example`, untrack it:

```powershell
git rm --cached <path>
```

## 🟢 4) Confirm `.env.dev` is NOT tracked

```powershell
git ls-files | Select-String "\.env\.dev"
# Should print nothing
```

`.env.dev` lives only on your laptop. The `.gitignore` `.env.*` rule
excludes it. Never commit it.

## 🟡 5) Pick the Redis story before push

The boot logs you saw were Redis reconnect loops because Docker Redis
was stopped. Two options — choose one and document it:

### Option A — Keep Redis required (production-grade)

```powershell
# Start the docker container before each dev run
docker start rem-redis
# OR: make sure docker-compose is up
docker compose up -d redis
```

### Option B — Make Redis optional in dev (no docker needed)

Comment out the `REDIS_URL` line in `src/config/.env.dev`:

```
# REDIS_URL=redis://localhost:6379    ← commented out
```

The server will detect Redis is disabled and use in-memory fallbacks
(presence, cache, sessions, rate limiter) — single-instance only but
fine for FE development. The Redis reconnect spam will disappear.

## 🟢 6) Final pre-push sanity check

```powershell
# Tests still green?
npm test
# Expected: 49 passed, 49 total

# Boot test (Ctrl+C after "http server listening")
npm run dev

# Tracked file count should drop massively after step 1
git ls-files | Measure-Object | Select-Object -ExpandProperty Count
# Expected: ~200 (down from 19,203)
```

## 🟢 7) Push

```powershell
git push origin <your-branch>
```

If you removed node_modules in step 1, the push will be much smaller
than before. GitHub may also warn about previously-committed large
blobs in the history — for a graduation project that's fine, but if
you want a clean history, see the optional step below.

## 🔴 OPTIONAL — Scrub `node_modules` from git history

Removing files from tracking does NOT delete them from history. The
repo's `.git` folder still contains them, and `git clone` will still
download all of it. To purge for real:

```powershell
# Install git-filter-repo first: https://github.com/newren/git-filter-repo
git filter-repo --path node_modules --invert-paths

# Then force-push (destroys history — coordinate with collaborators)
git push --force-with-lease origin --all
```

⚠️ **Don't do this if anyone else has cloned the repo** — they'll have
to delete and re-clone.

## ✅ Quick reference — minimum required steps

```powershell
# 1. Untrack node_modules
git rm -r --cached node_modules

# 2. Decide on Redis (start docker OR comment out REDIS_URL in .env.dev)
docker start rem-redis
# OR edit src/config/.env.dev and comment REDIS_URL

# 3. Verify
git ls-files | Measure-Object | Select-Object -ExpandProperty Count
npm test

# 4. Commit + push
git commit -m "chore: stop tracking node_modules + redis fixes"
git push
```

## Files that should stay (don't delete)

- `ai-services/` — actually used by `me.service.js` + `metrics.service.js`
  (Python AI services — gradually migrating to JS but live for now)
- `docs/` — SECURITY.md, NAMING-CONVENTION.md, SECRETS-ROTATION.md,
  PRE-PUSH-CLEANUP.md (this file), JIRA-SLACK-INTEGRATION-CHECK.md
- `scripts/migrate.js` — DB migration runner
- `tests/` — postman collection, qa-frontend, integration tests
- `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`
- `src/uploads/.gitkeep` — preserves the empty folder structure;
  actual uploads are gitignored
