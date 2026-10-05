# API Reference

All routes run on the Node.js runtime (`runtime: "nodejs"`) with dynamic rendering
(`dynamic: "force-dynamic"`). They server-side call the LiveKit Server SDK through
`lib/livekit/adapter` and return JSON.

## Base URL

When running locally: `http://localhost:3000/api`

---

## Authentication

Every route requires a dashboard session except the four listed below.

`POST /api/auth/login` verifies the email and password against `dashboard_admins`
using scrypt, issues an HMAC-signed session token in an HttpOnly cookie, and
records the attempt in the audit log. `authenticate()` re-verifies the session
row on each request, so a revoked or expired session stops working immediately
rather than at token expiry.

| Route | Auth | Notes |
|-------|------|-------|
| `POST /api/auth/login` | none | Sets the session cookie |
| `POST /api/auth/logout` | optional | Always clears the cookie |
| `GET /api/health` | none | Dashboard liveness, see below |
| `POST /api/webhooks/livekit` | JWT signature | LiveKit's own `Authorization` header |
| `GET /api/webhooks/livekit` | none | Informational text only |
| `GET /api/stream` | at connect | See the SSE note below |

Unauthenticated calls to a protected route return `401` with
`{"error": "unauthorized"}`.

The client sends the cookie automatically, so browser callers need nothing extra.
Command-line callers need a cookie jar:

```sh
curl -c jar.txt -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"ops@example.test","password":"..."}'
curl -b jar.txt http://localhost:3000/api/rooms
```

### `POST /api/auth/login`

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | Yes | |
| `password` | string | Yes | |
| `remember` | boolean | No | Only `true` counts; anything else gets the 30-minute idle window |

**`200 OK`** — `{ "ok": true, "user": { "id", "email", "name", "role" } }`, plus
`Set-Cookie` with `Max-Age` of `28800` when `remember` is `true` and `1800`
otherwise. The idle window is stored per session row, and `authenticate()`
renews expiry against that stored value — so an unremembered session stays at 30
minutes of inactivity for its whole life instead of being silently extended by
the sliding renewal.

**Errors:** `400` `missing_credentials` or `invalid_json`, `401`
`invalid_credentials`. A failed attempt is audited with `ok: false`.

### `POST /api/auth/logout`

Revokes the session server-side and clears the cookie. Returns `200 OK` even with
no valid session, so logging out twice is not an error.

---

## Health

### `GET /api/health`

Liveness for the dashboard's own dependencies, distinct from LiveKit's own
health. It answers "can the dashboard reach anything", so an empty UI can be
attributed to a broken LiveKit server rather than a broken dashboard.

Returns `200` even when a dependency is down — the dashboard is still serving, and
a load balancer restarting it would not help. `ok` carries the verdict.

```json
{
  "ok": true,
  "livekit": {
    "ok": true,
    "roomService": true,
    "egress": true,
    "ingress": true,
    "sip": true,
    "agents": true
  },
  "events": { "storeConfigured": true, "streamSubscribers": 2 },
  "checkedAt": "2026-10-05T08:00:00.000Z"
}
```

`ok` is `livekit.ok && events.storeConfigured`: without a database there are no
sessions and no event history, so the dashboard is not functional even if LiveKit
answers.

---

## Configuration

### `GET /api/config`

Cluster URL, whether credentials are set, and reachability.

**Response:** `200 OK`

```json
{
  "configured": true,
  "url": "http://localhost:7880",
  "hasApiKey": true,
  "hasApiSecret": true,
  "region": "auto",
  "connectionStatus": "connected",
  "roomCount": 1,
  "error": null
}
```

| `connectionStatus` | Meaning |
|--------------------|---------|
| `connected` | Reached the server |
| `error` | Configured, but the call failed (see `error`) |
| `not_configured` | Missing required env vars |
| `unknown` | Not yet attempted |

**Used by:** `useConfig()`.

---

## Rooms

### `GET /api/rooms`

```json
{
  "rooms": [
    {
      "name": "phase3-room",
      "sid": "RM_6Xc9xhhadqeJ",
      "numParticipants": 0,
      "numPublishers": 0,
      "numSubscribers": null,
      "emptyTimeout": 300,
      "departureTimeout": null,
      "maxParticipants": 8,
      "creationTimeMs": "1791187397301",
      "metadata": "{\"purpose\":\"verification\"}",
      "activeRecording": false,
      "turnPasswordPresent": false,
      "codecs": ["audio/PCMU", "video/VP8"]
    }
  ]
}
```

`numSubscribers` and `departureTimeout` are `null` when absent from the installed
protocol version, rather than `0`. `creationTimeMs` is a string because it exceeds
what a JSON number should carry between JavaScript and Go.

Audited as `room.list`. **Used by:** `useRooms()` (polls every 4s).

### `POST /api/rooms`

Creates a room. Audited as `room.create` with the room name as the target.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | Yes | Room name as used by participants |
| `maxParticipants` | number | No | Positive integer |
| `metadata` | string | No | Passed through verbatim |
| `emptyTimeout` | number | No | Seconds; server default when omitted |
| `departureTimeout` | number | No | Seconds; LiveKit default when omitted |
| `nodeId` | string | No | Pin the room to a node |

**`201 Created`** — `{ "room": { ...RoomDTO } }`, same shape as one entry of the
list above.

**Errors:** `400` `invalid_json`, `invalid_name`, `invalid_max_participants`, or
`invalid_timeouts`. A `name` that is already live returns `409 room_exists`.

### `GET /api/rooms/:name`

One room, or `404` `not_found`. Audited as `room.get`. **Used by:** `useRoom()`.

### `DELETE /api/rooms/:name`

Deletes the room. Audited as `room.delete`.

`404` `not_found` when the room is not live, including the case where it ended on
its own between the operator's list refresh and this call — the caller's intent
is satisfied either way, and distinguishing it from a cluster outage matters.
`500` only when the cluster cannot be reached.

### `GET /api/rooms/:name/participants`

```json
{
  "participants": [
    {
      "identity": "user-123",
      "sid": "PA_abc",
      "state": "ACTIVE",
      "joinedAtMs": "1791187397301",
      "name": "John Doe",
      "metadata": null,
      "attributes": {},
      "isPublisher": true,
      "canPublish": true,
      "canSubscribe": true,
      "canPublishData": false,
      "tracks": [
        {
          "sid": "TR_1",
          "type": "AUDIO",
          "source": "MICROPHONE",
          "name": "audio",
          "muted": false,
          "stream": null,
          "simulcast": false,
          "mid": null,
          "width": null,
          "height": null,
          "codecMime": "audio/opus",
          "layers": 0
        }
      ]
    }
  ]
}
```

Track `type` is `"AUDIO" | "VIDEO" | "DATA" | "UNKNOWN"` and `source` is
`"CAMERA" | "MICROPHONE" | "SCREEN_SHARE" | "SCREEN_SHARE_AUDIO" | "UNKNOWN"` —
named, not the numeric protocol enums, so a reordering upstream cannot silently
reinterpret the UI.

**The server does not report per-participant RTT, packet loss, bitrate, device, or
browser.** Those fields existed only in the mock data and are not returned. The
UI shows `n/a` instead of a number it cannot obtain.

Audited as `participant.list`. **Used by:** `useParticipants()` (polls every 3s).

### `DELETE /api/rooms/:name/participants/:identity`

Removes a participant. Audited as `participant.kick` with the room in `metadata`.
Returns `{ "success": true }`.

### `POST /api/rooms/:name/participants/:identity/tracks/:trackSid/mute`

Body: `{ "muted": boolean }`. Audited as `track.mute`. Returns `{ "success": true }`.

---

## Tokens

### `POST /api/tokens`

Mints a participant access token. **Authenticated and audited**
(`token.create`, with room and publish rights in `metadata`): this route holds the
cluster API secret and will mint a token for any identity the caller names, so
leaving it open is an unauthenticated way into every room.

**Request body:** the grant fields. Every field is optional except `identity`.
Booleans default to *absent*, not `false` — LiveKit reads an absent grant as
"default", and `canPublishData` defaults to `true`, so sending an explicit
`false` is a real decision rather than a no-op.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `identity` | string | Yes | Non-empty |
| `room` | string | No | `""` joins any room the participant is allowed into |
| `roomJoin` | boolean | No | |
| `canPublish` | boolean | No | |
| `canSubscribe` | boolean | No | |
| `canPublishData` | boolean | No | LiveKit defaults this to `true` when unset |
| `canPublishSources` | string[] | No | `camera`, `microphone`, `screen_share`, `screen_share_audio` |
| `canUpdateOwnMetadata` | boolean | No | |
| `hidden` | boolean | No | Participant hidden from other participants |
| `recorder` | boolean | No | |
| `roomCreate`, `roomList` | boolean | No | |
| `roomRecord` | boolean | No | |
| `roomAdmin` | boolean | No | |
| `ingressAdmin`, `sipAdmin`, `sipCall` | boolean | No | |
| `ttlSeconds` | number | No | Defaults to 21600; must be positive and at most 86400 |
| `name` | string | No | Display name |
| `metadata` | string | No | Free-form JSON handed to the participant on join |

`canPublishSources` takes the public names above. The route maps them to the
protocol's `TrackSource` values and rejects an unknown name rather than
silently dropping it — a token that grants fewer rights than the form showed was
the original bug this guards against.

**`200 OK`:** `{ "token", "url", "identity", "expiresIn" }`.

**Errors:** `400` with a specific message for a non-object body, a missing or
non-string `identity`, a non-string `room`/`name`/`metadata`, a non-boolean
grant, a non-positive or over-24-hour `ttlSeconds`, a `canPublishSources` that
is not an array of strings, or an unrecognised track source. `400`
`LiveKit is not configured.` when credentials are missing.

---

## Egress

### `GET /api/egress`

Lists egress entries, active and completed.

```json
{
  "egresses": [
    {
      "egressId": "EG_abc",
      "roomName": "meeting-room-1",
      "roomId": "RM_abc",
      "status": "EGRESS_ACTIVE",
      "startedAt": 1716090000000,
      "endedAt": 0,
      "error": null
    }
  ],
  "mock": false
}
```

`mock` is always `false`; egress comes from the server.

### `POST /api/egress`

Starts or stops a recording. **Authenticated and audited** (`egress.start`,
`egress.stop`) — an unauthenticated caller could otherwise record any room.

**Start:** `{ "action": "start", "roomName", "filepath"?, "audioOnly"? }`.
Writes MP4 via `EncodedFileOutput`, layout `speaker`,
`EncodingOptionsPreset.H264_720P_30`.

**Stop:** `{ "action": "stop", "egressId" }`.

**Errors:** `400` invalid request or not configured, `500` server failure.

---

## Participants across rooms

### `GET /api/users`

Searches participants cluster-wide. `?room=` returns that room's list through the
adapter; otherwise every room is scanned and rooms that error are skipped rather
than failing the request. `?identity=` filters to one identity.

```json
{
  "participants": [
    {
      "room": "phase3-room",
      "identity": "user-123",
      "sid": "PA_abc",
      "state": "ACTIVE",
      "isPublisher": true,
      "trackCount": 2,
      "joinedAt": "2026-10-05T08:03:17.301Z"
    }
  ],
  "totalRooms": 1,
  "totalParticipants": 3
}
```

`totalParticipants` is omitted when filtering by identity. `joinedAt` is derived
from `joinedAtMs` as **milliseconds**.

### `DELETE /api/users`

Body `{ "room", "identity" }`. Removes the participant. Audited as
`participant.remove`. Returns `{ "ok": true }`.

---

## Webhooks

### `POST /api/webhooks/livekit`

Receives webhook events. The `Authorization` header is verified with the LiveKit
SDK's receiver; an unsigned or tampered body is rejected with `401` before any
parsing.

Configure the server:

```yaml
webhook:
  urls:
    - http://localhost:3000/api/webhooks/livekit
```

For a remote server, use a tunnel:

```sh
ngrok http 3000
# then set the webhook URL to https://abc123.ngrok.io/api/webhooks/livekit
```

On success the event is written to PostgreSQL (`dashboard_webhook_events`, keyed
by LiveKit's event id, so a redelivery does not duplicate a row) and then
published on the in-process SSE bus. **A store failure does not fail the
request** — LiveKit would retry, and a retry storm against a slow database is
worse than one event only visible on the next poll.

**Responses:** `200` `{ "ok": true, "stored": true | false }` (`stored: false`
means the event was a redelivery), `401` invalid signature, `400` invalid JSON.

### `GET /api/webhooks/livekit`

Informational text. No auth, no data.

---

## Events

### `GET /api/events`

Webhook events from PostgreSQL, newest first.

**Query parameters:**

| Parameter | Type | Default | Notes |
|-----------|------|---------|-------|
| `limit` | number | 100 | Clamped to 1-1000 |
| `room` | string | all | Indexed in SQL |
| `type` | string | all | Indexed in SQL |
| `participant` | string | all | Filtered in JS; no index |
| `since` | number | none | Unix seconds, filtered in JS |

```json
{
  "events": [
    {
      "id": "evt_abc",
      "event": "room_started",
      "createdAt": 1759641600,
      "room": "phase3-room",
      "participant": null,
      "raw": { "event": "room_started" }
    }
  ],
  "filters": { "rooms": ["phase3-room"], "participants": [], "eventTypes": ["room_started"] }
}
```

Audited as `events.list`. **Used by:** `useEventStream()` for the fallback poll,
`useRoomEvents()` for a room's own history.

### `DELETE /api/events`

Clears the event log. Audited as `events.clear`. Requires an explicit confirmation
in the UI.

### `GET /api/stream`

Server-sent events. Query `?room=` scopes the stream; `all` or absent means
everything.

Event names: `ready` on connect, `webhook` per event, plus a `: keep-alive`
comment every 25s.

Two things worth knowing:

- **Auth is checked once at connect.** `EventSource` cannot send headers, so the
  cookie is the only credential; a session revoked after connecting keeps its open
  stream until it closes or the heartbeat notices.
- **The bus is in-process.** Two dashboard instances each see only their own
  webhooks. PostgreSQL is the source of truth and the client polls every 10s, so
  nothing is lost — but a multi-instance deployment needs shared pub/sub for
  sub-second delivery.

---

## Monitoring

### `GET /api/monitoring`

Room aggregates from the RoomService, process and media metrics from the
Prometheus endpoint, and stored history for the charts.

**Requires `LIVEKIT_METRICS_URL`.** Without it every metric below is `null` and
`system.available` is `false` — nothing is substituted.

```json
{
  "rooms": { "total": 1, "active": 0 },
  "participants": { "total": 0, "publishers": 0, "avgPerRoom": 0 },
  "capacity": { "max": 8, "utilization": 0 },
  "recordings": {
    "active": 0,
    "egress": [
      {
        "id": "EG_abc",
        "roomName": "phase3-room",
        "status": "active",
        "startedAt": "2026-10-05T08:03:17.301Z"
      }
    ]
  },
  "roomDetails": [
    {
      "name": "phase3-room",
      "sid": "RM_6Xc9xhhadqeJ",
      "participants": 0,
      "publishers": 0,
      "maxParticipants": 8,
      "recording": false,
      "createdAt": "2026-10-05T08:03:17.301Z",
      "metadata": ""
    }
  ],
  "system": {
    "available": true,
    "error": null,
    "cpuPercent": 0.31,
    "ramBytes": 60612608,
    "heapBytes": 12492800,
    "goroutines": 151,
    "openFds": 27,
    "uptimeSeconds": 2180.61,
    "networkRxBytes": 3100021355,
    "networkTxBytes": 2334386354,
    "host": null
  },
  "webrtc": {
    "jitterSeconds": 0,
    "latencyMsAvg": null,
    "latencyMsP95": null,
    "packetLossRatio": null,
    "packetsOut": 0,
    "packetsDropped": 0
  },
  "quality": { "scoreAvg": null, "scoreCount": 0 },
  "webhooks": { "dispatched": 9, "failed": 1, "queueLengthAvg": 1 },
  "metrics": {
    "rooms": { "total": 0, "avgDurationSeconds": 48.08 },
    "participants": { "connected": 0, "total": null },
    "transports": { "packetsOut": 0, "packetsDropped": 0, "packetLossRatio": null },
    "quality": { "scoreAvg": null, "scoreCount": 0 },
    "webrtc": { "jitterSeconds": 0, "latencyMsAvg": null, "latencyMsP95": null },
    "api": { "twirpLatencyMsAvg": 1.33 }
  },
  "history": [
    {
      "at": "2026-10-05T08:02:36.495Z",
      "rooms": 0,
      "participants": 0,
      "packetsOut": 0,
      "packetsDropped": 0,
      "packetLossRatio": null,
      "qualityScore": null,
      "latencyMs": null,
      "cpuSecondsTotal": 8.07,
      "cpuPercent": 0.31,
      "residentMemoryBytes": 60612608,
      "webhooksFailed": 1
    }
  ],
  "collectedAt": "2026-10-05T08:02:41.000Z"
}
```

Notes on the nulls, since they are the point:

- **`system.host` is always `null`.** The Prometheus series describe the
  livekit-server *process*, not the machine under it. Reporting host CPU would
  require reaching outside this service.
- **`webrtc.latencyMsP95` is always `null`.** LiveKit exports
  `livekit_forward_latency_ns_sum`/`_count` but no buckets, so a quantile cannot
  be derived without inventing a distribution.
- **`metrics.participants.total` is `null`.** `livekit_participant_total` is a
  gauge of current connections, not a cumulative counter.
- **`metrics.api.twirpLatencyMsAvg` is control-plane latency**, kept separate from
  `webrtc.latencyMsAvg`, which comes from the media forwarding histogram. They are
  different things and the route never substitutes one for the other.
- **`cpuPercent` is null on the first sample of a window.** `process_cpu_seconds_total`
  is a counter, so a percentage is a delta between two stored samples. The first
  point has no baseline. Deriving it in the store rather than in memory means the
  value survives a dashboard restart.
- **History keeps a null point where a sample was unavailable.** The point stays
  in the series with every metric `null`, and charts render it with
  `connectNulls={false}`, so an outage shows as a gap rather than a flat line
  implying steady state. Dropping the row entirely, or bridging across it, would
  both misrepresent the outage. A metric that recovers also gets no value on its
  first sample, because there is no baseline to compute a delta from.
  Snapshots are rate-limited to one per 30 seconds; retention is 24 hours,
  enforced on write since there is no scheduler.
- **`recordings.active` counts rooms, not jobs.** It is the union of active
  egress jobs and rooms flagged `activeRecording`, deduplicated by room name. A
  room carrying the flag is normally the same job the egress list reports, so
  summing the two counted one recording twice.

Charts on the dashboard and monitoring pages read `history`. They have no internal
timer and generate nothing: a chart that invents points looks alive while telling
you nothing.

**Per-room metrics are not available.** LiveKit labels media series with
`node_id`, never with a room name, so per-room CPU, bitrate, or packet loss cannot
be read from this endpoint and is not charted.

**Used by:** `useMonitoring()` (polls every 5s, aborts in flight).

---

## Error Handling

Errors are `{"error": "<code or message>"}`. Codes are machine-readable
(`unauthorized`, `not_found`, `invalid_credentials`); LiveKit errors are passed
through as their message.

| Code | Meaning |
|------|---------|
| 200 | Success |
| 307 | Redirect to `/login` for an unauthenticated page request |
| 400 | Bad request, or LiveKit not configured |
| 401 | Unauthenticated, or an invalid webhook signature |
| 404 | Room does not exist |
| 500 | Upstream failure |

## Audit log

Mutating and read operations are written to `dashboard_audit_log` with the admin
id, email, action, target, and redacted metadata. Recorded actions include
`auth.login`, `auth.logout`, `auth.login_failed`, `room.list`, `room.get`,
`room.delete`, `participant.list`, `participant.kick`, `participant.remove`,
`track.mute`, `token.create`, `egress.start`, `egress.stop`, `events.list`,
`events.clear`, and `webhook.received`.

## Rate limiting

There is no per-IP rate limiting on dashboard routes. Put a rate limiter in front
of the deployment (nginx, Cloudflare, `@upstash/ratelimit`) — `/api/auth/login`
is the endpoint worth protecting first.

The metrics endpoint is not rate limited either; instead `/api/monitoring`
collapses concurrent scrapes behind a 2-second cache, so N open tabs cost one
request to Prometheus, not N.
