# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# base: Node 22 + pnpm, the exact manager the lockfile was generated with.
# Pinned so CI and local builds resolve the same dependency tree.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base

RUN npm install -g pnpm@12.16.1

WORKDIR /app

# ---------------------------------------------------------------------------
# deps: dependencies only, so a source-only change does not reinstall them.
# ---------------------------------------------------------------------------
FROM base AS deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder: compiles the app.
#
# This dashboard keeps every credential (LIVEKIT_API_SECRET, DATABASE_URL,
# DASHBOARD_SESSION_SECRET) server-side at RUNTIME. No NEXT_PUBLIC_* value is
# baked into the browser bundle, so the build needs no secrets and the image
# can be published to a registry as-is.
# ---------------------------------------------------------------------------
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm build

# ---------------------------------------------------------------------------
# runner: ships only the standalone server, its traced dependencies and the
# static assets. No install step, no source, no dev tooling.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

# `server.js` is the entrypoint emitted by `output: "standalone"`.
CMD ["node", "server.js"]
