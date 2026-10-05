# AGENTS.md — LiveKit Dashboard

Single-page Next.js 16 App Router dashboard (`livekit-nextjs-starter`). Not a monorepo.

## Quick start

```sh
pnpm install          # install deps
pnpm dev              # next dev (http://localhost:3000)
pnpm build            # next build
pnpm lint             # eslint . (no custom config; falls back to Next.js defaults)
```

## Project structure

```
app/                   # Next.js App Router pages
  (app)/               # Route group — pages behind the app shell (sidebar + topbar)
    dashboard/
    rooms/
    rooms/[id]/
    tokens/
    monitoring/
    logs/
    settings/
  login/               # Real credential login; issues the session cookie
  api/
    auth/login|logout/ # POST — session lifecycle
    health/            # GET — public liveness
    config/            # GET — LiveKit connection status
    rooms/             # GET — list rooms, POST — create room
    rooms/[name]/      # GET — one room, DELETE — delete room
    rooms/[name]/participants/ — GET — list, DELETE — remove, PATCH — mute track
    users/             # GET — participants across rooms, DELETE — remove
    tokens/            # POST — mint access token (JWT), with grant validation
    egress/            # GET — list egress, POST — start/stop recording
    monitoring/        # GET — aggregated metrics + stored history
    events/            # GET — webhook event history, DELETE — clear
    webhooks/livekit/  # POST — receive LiveKit webhooks (public, signed)
components/
  ui/                  # shadcn/ui primitives (new-york style)
  shell/               # AppShell, SidebarNav, Topbar, CommandPalette
  dashboard/           # DashboardOverview, StatsCard, MetricChart, StatusBadge
  rooms/               # RoomsView, RoomDetailView
  logs/                # LogsView
  tokens/              # TokensView
  monitoring/          # MonitoringView
  settings/            # SettingsView
hooks/                 # useRooms, useParticipants, useEgress, useConfig
lib/
  livekit-server.ts    # RoomServiceClient, EgressClient, WebhookReceiver, AccessToken
  livekit/adapter.ts   # LiveKitAdapter: DTOs the browser consumes, RoomService behind it
  auth/session.ts      # authenticate() — the entry point every route and server component uses
  auth/session-token.ts # HMAC cookie token, TTL constants
  events/store.ts      # Postgres-backed webhook event store
  metrics/collect.ts   # Prometheus scrape + 2s cache
  metrics/store.ts     # Snapshots, retention, CPU-from-counter-delta
  i18n.tsx             # en/fa + RTL provider
  utils.ts             # cn(), formatDuration(), formatBytes()
livekit-server/
  docker-compose.yaml  # LiveKit + Redis + SIP for local dev
```

## Key env vars (copy `.env.local.example` → `.env`)

```
DATABASE_URL=postgres://...
DASHBOARD_SESSION_SECRET=<openssl rand -hex 32>
LIVEKIT_URL=http://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_REGION=auto
LIVEKIT_METRICS_URL=http://localhost:9090/metrics
```

Postgres is required: sessions, the audit log and metric snapshots all live
there. Run `pnpm db:migrate` and `pnpm admin:create` before the first sign-in.

## Architecture facts

- **Frontend-only**: This is a Next.js app. It calls the LiveKit Server SDK from server-side API routes (not from the client). All API routes use `runtime: "nodejs"` and `dynamic: "force-dynamic"`.
- **Real auth**: `POST /api/auth/login` verifies scrypt credentials against `dashboard_admins` and issues an HMAC-signed HttpOnly session backed by a Postgres row. `app/(app)/layout.tsx` calls `authenticate()` and redirects anonymous visitors to `/login`; every API route except the four public ones (login, logout, health, webhook) checks independently. The auth check cannot live in middleware — that runs on the Edge runtime and cannot reach Postgres.
- **No fabricated values anywhere**: A metric the LiveKit server does not export stays `null` and the UI shows `n/a`. No random numbers, no demo data, no placeholder uptime. See the "Notes on the nulls" section in `docs/api-reference.md`.
- **Snap/polling — no WebSockets**: Hooks poll on fixed intervals: rooms every 4s, egress every 5s, participants every 3s. `GET /api/events` is an SSE stream with polling as the fallback.
- **Webhook store is Postgres-backed**, and events are deduplicated by `(source, eventId)` so a webhook redelivery is idempotent.
- **Token grants are round-trip tested**: `lib/livekit-server.test.ts` decodes the signed JWT and asserts on claims, because the token form once showed permissions that `createAccessToken` silently dropped.
- **TypeScript errors fail the build**: `next.config.mjs` sets `ignoreBuildErrors: false`. Run `npx tsc --noEmit` for a faster loop.
- **Tests exist**: `pnpm test` runs offline. `LIVEKIT_E2E=1 pnpm test` and `DB_E2E=1 pnpm test` add the suites that need a real cluster or database.
- **shadcn/ui**: Uses `new-york` style. Add new primitives via `pnpm dlx shadcn@latest add <component>`. Components use `@/components/ui/`, utils from `@/lib/utils.ts` (`cn` function).
- **Tailwind v4**: CSS uses `@import "tailwindcss"` and `@import "tw-animate-css"` (NOT `@tailwind` directives). Theme variables via `@theme inline {}`. PostCSS plugin is `@tailwindcss/postcss`.
- **i18n**: en/fa with RTL auto-switching. Locale persisted in `localStorage` key `"locale"`. Use `useI18n()` for `t()`, `locale`, `dir`.
- **Dark mode by default**: `defaultTheme="dark"` in `ThemeProvider`. Light mode possible via toggle.
- **Path alias**: `@/*` maps to project root (not `src/`).

## Local LiveKit

```sh
cd livekit-server && docker compose up
```

Starts LiveKit in dev mode on `:7880` with Redis on `:6379`. Matches the default `.env.local` credentials.
