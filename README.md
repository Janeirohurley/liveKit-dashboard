# LiveKit Dashboard

Operator console for a self-hosted [LiveKit](https://livekit.io) deployment. Inspect rooms, manage participants, mint access tokens, run egress recordings, and watch real-time WebRTC and process metrics.

## What it does

- **Rooms** — live room list with real participant, publisher and codec counts; create and delete rooms; bulk delete; inspect detail per room.
- **Participants** — inspect, mute published tracks, and remove participants; cross-room participant view.
- **Tokens** — mint signed JWTs with the full grant set, including SIP and track-source permissions. Presets for viewer, publisher and admin.
- **Egress** — start and stop room composite recordings.
- **Monitoring** — CPU, memory, network, WebRTC transport stats and quality scores, read from a Prometheus endpoint, plus 24h of stored history.
- **Webhooks** — LiveKit webhook receiver, signature-verified, with a persisted, idempotent event log and an SSE stream.
- **Audit log** — every privileged action recorded against the operator who performed it.

## Principles

**Nothing is invented.** Every number in the UI comes from the LiveKit server, a Prometheus endpoint, or Postgres. A metric that is not exported stays `null` and renders as `n/a`. There is no demo mode, no random data and no placeholder uptime. `docs/api-reference.md` documents each `null` and why it is null.

**Every action is attributable.** Authentication is real: scrypt credentials, HMAC-signed HttpOnly session cookies backed by database rows, and revocation that takes effect immediately. The operator's identity is threaded from the server layout into the UI, so audit entries name the person who did the work.

## Quick start

### Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/)
- Docker (for the local LiveKit stack)
- PostgreSQL (sessions, audit log and metric snapshots all live there)

### Install

```sh
pnpm install
```

### Configure

```sh
cp .env.local.example .env
```

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/livekit_dashboard
DASHBOARD_SESSION_SECRET=<openssl rand -hex 32>

LIVEKIT_URL=http://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
LIVEKIT_REGION=auto

# Optional; the monitoring page reports unavailable without it.
LIVEKIT_METRICS_URL=http://localhost:9090/metrics
```

### Start the dependencies

```sh
cd livekit-server && docker compose up
```

Brings up the LiveKit server on `:7880` and Redis. For the monitoring page, run a Prometheus with `/metrics` scraped from LiveKit.

### Create the schema and an account

```sh
pnpm db:migrate    # idempotent
pnpm admin:create  # prompts for email and password
```

### Run

```sh
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the account you created. There is no demo mode; unauthenticated requests to protected pages redirect to `/login` and protected APIs return `401`.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Development server on `:3000` |
| `pnpm build` | Production build (fails on a TypeScript error) |
| `pnpm start` | Run the production build |
| `pnpm lint` | ESLint |
| `pnpm test` | Test suite, runs fully offline |
| `pnpm test:watch` | Tests in watch mode |
| `LIVEKIT_E2E=1 pnpm test` | Adds adapter tests against a real LiveKit server |
| `DB_E2E=1 pnpm test` | Adds event store and snapshot tests against a real Postgres |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm admin:create` | Create an operator account |

The offline suite uses placeholder credentials injected by `vitest.config.mts`, so token tests can sign real JWTs without a cluster.

## Documentation

| Document | Contents |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | How the pieces fit: auth, adapter boundary, metrics, events |
| [`docs/api-reference.md`](docs/api-reference.md) | Every route, request and response shape, and what each `null` means |
| [`docs/development.md`](docs/development.md) | Setup, conventions, adding routes and components, testing, deployment |
| [`AGENTS.md`](AGENTS.md) | Quick orientation for coding agents working in this repo |

## Security notes

- **Session cookie** is HttpOnly, `SameSite=Lax`, and `Secure` in production. The signing key never leaves the server.
- **Sessions are revocable.** Logout sets `revoked_at`; a password change bumps `admin.token_version` and invalidates every outstanding session at once.
- **The auth check is not in middleware.** Middleware runs on the Edge runtime and cannot reach Postgres, so `app/(app)/layout.tsx` and each API route call `authenticate()` directly.
- **Four routes are public**: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/health`, `POST /api/webhooks/livekit`. Everything else requires a session.
- **Webhooks are signature-verified** against the API secret and deduplicated by `(source, eventId)`.
- **Login attempts are audited**, with a constant-time path for unknown accounts. There is no in-app rate limiting: put a limiter in front of the deployment, starting with `/api/auth/login`.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19 |
| Language | TypeScript 5.7, strict, build-enforced |
| Styling | Tailwind CSS v4 |
| UI | shadcn/ui (new-york), Radix |
| Charts | Recharts |
| Server SDK | livekit-server-sdk v2 |
| Database | PostgreSQL via `postgres` |
| Metrics | Prometheus text format |
| Tests | Vitest |
| i18n | en / fa with RTL |