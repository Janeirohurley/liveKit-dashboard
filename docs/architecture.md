# Architecture Documentation

## System Design

The LiveKit Dashboard is a Next.js admin console for a self-hosted LiveKit server.
Server components handle session checks, API routes talk to LiveKit and PostgreSQL
on the server, and the browser polls the dashboard's own API for data.

```
┌─────────────────────────────────────────────────────────────────┐
│                          Browser                                 │
│                                                                   │
│  React components under app/(app)/, which is session-gated       │
│  server-side: unauthenticated visitors get a 307 to /login.      │
│                                                                   │
│  Custom hooks own all fetching:                                  │
│    useRooms()          rooms list, 4s poll                       │
│    useRoom()           one room                                  │
│    useParticipants()   participants + tracks, 3s poll            │
│    useMonitoring()     aggregates + metrics history, 5s poll     │
│    useEventStream()    SSE with a 10s polling fallback           │
│    useRoomEvents()     persisted events for one room             │
│    useConfig()         cluster reachability                     │
│                                                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ fetch(), cookies attached
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js Server (Node.js)                      │
│                                                                   │
│  app/(app)/layout.tsx  authenticate() → redirect /login          │
│                                                                   │
│  API routes — every one authenticated except the four below      │
│    /api/auth/login    /api/auth/logout                           │
│    /api/health        (public liveness)                          │
│    /api/webhooks/*    (LiveKit's own JWT signature)              │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  lib/auth/ — sessions, scrypt, audit log                   │  │
│  │    dashboard_admins · dashboard_sessions                   │  │
│  │    dashboard_audit_log (redacted metadata)                 │  │
│  └──────────────────────┬────────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────┴────────────────────────────────────┐  │
│  │  lib/livekit/adapter.ts — one typed DTO layer              │  │
│  │    maps protocol enums to strings, so an upstream           │  │
│  │    reordering cannot silently reinterpret the UI            │  │
│  │    returns null for fields this protocol version lacks      │  │
│  └──────────────────────┬────────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────┴────────────────────────────────────┐  │
│  │  lib/metrics/ — measured values only                       │  │
│  │    prometheus.ts  text-format parser + aggregates          │  │
│  │    collect.ts     raw samples → MetricsSnapshot            │  │
│  │    store.ts       snapshot history, retention on write     │  │
│  └──────────────────────┬────────────────────────────────────┘  │
│                         │                                        │
│  ┌──────────────────────┴────────────────────────────────────┐  │
│  │  lib/webhook-store.ts + lib/events/bus.ts                  │  │
│  │    PostgreSQL is the source of truth; the bus fans out     │  │
│  │    in-process to SSE subscribers                            │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                   │
└──────────┬──────────────────────────────────┬───────────────────┘
           │                                  │
           │ Twirp (LiveKit SDK)              │ postgres
           ▼                                  ▼
┌────────────────────────────┐   ┌──────────────────────────────────┐
│  LiveKit Server (:7880)    │   │  PostgreSQL                      │
│  rooms · participants       │   │  admins · sessions · audit       │
│  egress · ingress · SIP     │   │  webhook events · metric history │
│  agents · webhooks          │   └──────────────────────────────────┘
└──────────┬─────────────────┘
           │
           ├──────────────► Prometheus endpoint (:9090/metrics)
           │                 Go client + process_* series
           ▼
      Redis (cluster bus)
```

## The no-fabrication rule

A dashboard is trusted to report the state of a system people make decisions
from. A plausible-looking number is worse than a missing one, because it cannot be
distinguished from a real reading. So the rule throughout: **a metric the server
does not report is `null`, and the UI renders "n/a" or an explicit empty state.**

Consequences worth knowing about, because they look like missing features:

- **Per-room metrics do not exist.** LiveKit labels media series with `node_id`,
  never with a room name. Per-room CPU, bitrate, or packet loss cannot be read
  from the metrics endpoint, so the room page does not chart them.
- **Host CPU and memory do not exist.** `process_*` describes the livekit-server
  process. The monitoring page reports the process and sets `system.host` to null.
- **Latency quantiles do not exist.** `livekit_forward_latency_ns` ships
  `_sum`/`_count` but no buckets, so only a mean is derivable.
- **Cumulative participants do not exist.** `livekit_participant_total` is a gauge
  of current connections.
- **CPU percent needs two samples.** `process_cpu_seconds_total` is a counter; the
  first point of any window has no baseline and reads null.
- **Per-participant RTT, loss, bitrate, device, and browser do not exist.** The
  RoomService does not report them. These fields were present in the mock data
  that the UI originally rendered.

## Directory Structure

```
app/
  (app)/            session-gated pages (dashboard, rooms, monitoring, logs, …)
  api/              route handlers; see docs/api-reference.md
  login/            unauthenticated
  page.tsx          redirects to /dashboard
components/
  dashboard/        stats-card, metric-chart, status-badge
  monitoring/       monitoring-view
  rooms/            room-detail-view
  logs/             logs-view
hooks/              one hook per polled resource
lib/
  auth/             session, password, token signing, audit
  db/               postgres client, idempotent migrations
  events/           in-process bus, shared event types
  livekit/          adapter and its tests
  metrics/          prometheus parser, collector, store, formatters
  webhook-store.ts  PostgreSQL event store
livekit-server/     docker compose: livekit, redis, prometheus port
```

## Data Flow

### 1. Session and page load

`app/(app)/layout.tsx` calls `authenticate(headers())`, which verifies the HMAC
cookie and then re-checks the session row. Any of no cookie, bad signature,
unknown session, revoked, expired, disabled account, or a `token_version` mismatch
(password changed since issue) resolves to null, and the layout redirects.

The check is in the layout rather than middleware because middleware runs on the
Edge runtime and cannot reach Postgres, where sessions live. API routes check
independently, so the layout is about not serving the shell to an anonymous
visitor, not about access control.

The resolved identity is passed into `AppShell`, so the topbar shows the operator
who is actually signed in. Hardcoding a name there would mean every audit entry on
a shared deployment points at the same fictitious person.

Session length is chosen at sign-in and stored on the session row: 30 minutes of
inactivity normally, 8 hours when "remember me" is ticked. Expiry is renewed on
every authenticated request against that stored value, so it behaves as an idle
timeout rather than a total session length — and an unremembered session stays at
30 minutes for its whole life instead of being silently extended back to 8 hours by
the renewal.

### 2. Room listing

`useRooms()` → `GET /api/rooms` → `authenticate()` → `adapter.listRooms()` →
audit → JSON. The client polls every 4 seconds and aborts any request still in
flight before starting the next, so a slow response cannot overwrite a newer one.

### 3. Webhook reception

```
LiveKit ──signed POST──► /api/webhooks/livekit
                              │
                              ├─ verify Authorization with WebhookReceiver  (401 on failure)
                              ├─ write to dashboard_webhook_events          (idempotent on event id)
                              └─ publish on lib/events/bus
                                        │
                                        ▼
                              /api/stream (SSE, ?room= scoping)
                                        │
                                        ▼
                              useEventStream() → logs view
```

A store failure does **not** fail the request: LiveKit would retry, and a retry
storm against a slow database is worse than one event that shows up on the next
poll.

The bus is in-process. With two dashboard instances each sees only its own
webhooks — nothing is lost, because PostgreSQL is the source of truth and the
client polls every 10 seconds, but sub-second delivery on a multi-instance
deployment needs shared pub/sub.

### 4. Metrics collection

```
/api/monitoring
   │
   ├─ collectMetrics()  ──► GET LIVEKIT_METRICS_URL  (2s cache, shared by all tabs)
   │                          └─ parsePrometheus → toSnapshot
   ├─ recordSnapshot()  ──► dashboard_metrics_snapshots  (1 write / 30s, 24h retention)
   └─ listSnapshots()   ──► history for the charts
```

CPU percentages are derived in the store, from the delta between two stored
counters, rather than from an in-memory previous value — so the number survives a
dashboard restart instead of going null until the second sample after every
redeploy.

An unavailable sample is still written, with every metric `null`. Dropping the row
would make an outage look like a gap in the series, and carrying the last value
forward would draw a flat line through it. Charts bridge with
`connectNulls={false}`, so the outage is visible. A metric that recovers gets no
value on its first sample either, since there is no baseline for the delta.

### 5. Recording counts

`recordings.active` is the number of distinct rooms being recorded, not the number
of signals that a recording is happening. It is the union of the active egress
jobs (`starting`, `active`, `ending`) and the rooms RoomService flags with
`activeRecording`, deduplicated by room name. Those two sources describe the same
job, so summing them counted a single recording twice. Egress statuses are mapped
through the SDK enum rather than a hand-written table, because a literal list
silently mislabels every status if the protocol ever renumbers.

## Key Design Decisions

### One adapter instead of raw SDK calls

Route handlers call `lib/livekit/adapter.ts`, which returns DTOs with string
enums and explicit nulls. Raw `ParticipantInfo` leaks numeric protocol enums into
the UI, where a reordering upstream would silently relabel a track type, and it
invites the `p.type === 0` comparisons that make a future migration dangerous.

The same rule is why `joinedAt` is read as milliseconds. The original code did
`new Date(Number(p.joinedAt) * 1000)`, making every join time wrong by three
orders of magnitude.

### Validate request bodies at the edge of the app

`app/api/tokens/route.ts` checks the request shape before any business logic runs.
A non-string `identity` used to be signed straight into a JWT, `"abc"` as
`ttlSeconds` became `NaN` in the expiry, and a non-array `canPublishSources`
threw out of the mapping — all reported as `500`, which tells the operator the
dashboard is broken when the mistake was in the request. Malformed input is the
caller's problem, so it is a `400` with a specific message.

The same reasoning is why `POST /api/rooms` rejects a duplicate name with `409`
rather than letting the SDK error pass through, and why `DELETE /api/rooms/:name`
returns `404` when the room is already gone: the caller's intent is satisfied
either way, and that has to be distinguishable from the cluster being unreachable.

### Retention enforced on write

There is no scheduler in this app, so pruning runs on the insert path. The write
is already rate-limited to one row per 30 seconds, so the delete cannot spin.

### Charts render what they are given

`MetricChart` takes `data` and `series` props and has no timer. It renders an
explicit empty state when `data` is empty. The previous version generated its own
points with `Math.random()` every two seconds, which meant the monitoring page
showed invented jitter, RTT, and packet loss derived from an invented network
percentage.

### Force-dynamic API routes

Every route sets `dynamic: "force-dynamic"` and `runtime: "nodejs"`. These
handlers depend on request cookies and on Postgres, neither of which can be read
at build time.
