# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────
# Production image — Node backend + pre-built Angular frontend.
#
# To build locally:
#   1. cd ../Front && npm run build -- --configuration=production
#   2. cp -r dist/remote-employee-monitoring/browser ../Back/public
#   3. cd ../Back && docker build -t rem-app .
#   4. docker run -p 3000:3000 --env-file .env rem-app
#
# For Railway / Render automatic deploys:
#   Push the repo (with the public/ folder committed) and connect
#   the service to this Dockerfile. Set env vars in the dashboard.
# ──────────────────────────────────────────────────────────────

# ── Stage 1: install backend production deps ───────────────────
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache tini

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Stage 2: runtime ───────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini

USER node

ENV NODE_ENV=production \
    MOOD=PROD \
    PORT=3000 \
    LOG_LEVEL=info

# Backend deps + source
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

# The Angular build lives in ./public (run `npm run deploy:build` to refresh it)
# App.controller.js serves it automatically when the folder exists.

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
