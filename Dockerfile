# syntax=docker/dockerfile:1.7

# ──────────────────────────────────────────────────────────────
# Stage 1 — deps
# ──────────────────────────────────────────────────────────────
# Cached separately so dependency installs don't re-run on every
# source change. The cache mount keeps npm's tarball cache between
# builds (BuildKit only).
FROM node:20-alpine AS deps
WORKDIR /app

# Tini supervises the node process so SIGTERM/SIGINT reach it cleanly
# (graceful shutdown depends on this).
RUN apk add --no-cache tini

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund


# ──────────────────────────────────────────────────────────────
# Stage 2 — runtime
# ──────────────────────────────────────────────────────────────
# Minimal image: only what's needed to run. No dev tooling, no
# build artifacts, no source maps.
FROM node:20-alpine AS runtime
WORKDIR /app

# Re-install tini in runtime stage (multi-stage layers don't carry
# apk installs across stages).
RUN apk add --no-cache tini

# Drop privileges. The default `node` user (uid 1000) ships in the
# official image — no useradd needed.
USER node

ENV NODE_ENV=production \
    MOOD=PROD \
    PORT=3000 \
    # Pino: structured JSON in prod (no pino-pretty)
    LOG_LEVEL=info

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

# Healthcheck probes the same liveness endpoint k8s would use.
# A failing /healthz means the event loop is wedged → restart.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000

# Tini reaps zombie children and forwards signals correctly to Node,
# which the graceful-shutdown handler relies on.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
