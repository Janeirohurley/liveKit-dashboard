# Development Guide

## Getting Started

### Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **pnpm** — Install with `npm install -g pnpm`
- **Docker** — For local LiveKit server ([Download](https://docker.com/))

### Initial Setup

```sh
# 1. Clone and install
pnpm install

# 2. Configure environment
cp .env.local.example .env
# Edit .env: LiveKit credentials, DATABASE_URL, and
# DASHBOARD_SESSION_SECRET (generate one with: openssl rand -hex 32)

# 3. Start LiveKit server (in a separate terminal)
cd livekit-server && docker compose up

# 4. Create the schema
pnpm db:migrate

# 5. Create an admin account (prompts for email and password)
pnpm admin:create

# 6. Start the dev server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the admin you
created. There is no demo mode: authentication is required, and the API routes
return `401` without a session.

Migrations are idempotent, so `pnpm db:migrate` is safe to re-run.

## Development Workflow

### Running the Dev Server

```sh
pnpm dev
```

- Starts Next.js on `http://localhost:3000`
- Hot module replacement (HMR) enabled
- Changes to components and pages reflect instantly

### Building for Production

```sh
pnpm build    # Compiles and optimizes
pnpm start    # Runs the production server
```

### Linting

```sh
pnpm lint     # Runs ESLint with Next.js defaults
```

## Adding a New Page

### Step 1: Create the Page

Create a new page file in `app/(app)/your-feature/page.tsx`:

```tsx
// app/(app)/your-feature/page.tsx
import { YourFeatureView } from "@/components/your-feature/your-feature-view"

export default function YourFeaturePage() {
  return <YourFeatureView />
}
```

### Step 2: Create the View Component

Create the view component in `components/your-feature/your-feature-view.tsx`:

```tsx
// components/your-feature/your-feature-view.tsx
"use client"

import { Card } from "@/components/ui/card"

export function YourFeatureView() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Your Feature</h1>
        <p className="text-muted-foreground">Description of your feature</p>
      </div>
      <Card className="p-6">
        {/* Your feature content */}
      </Card>
    </div>
  )
}
```

### Step 3: Add Navigation

Add a navigation item in `components/shell/sidebar-nav.tsx`:

```tsx
// Find the navItems array and add your entry:
{
  name: t("nav.yourFeature"),
  href: "/your-feature",
  icon: YourIcon,
}
```

### Step 4: Add Translations

Add translation keys in `lib/i18n.tsx` for both languages:

```typescript
// In the `en` dictionary:
"nav.yourFeature": "Your Feature",

// In the `fa` dictionary:
"nav.yourFeature": "ویژگی شما",
```

## Adding an API Route

### Step 1: Create the Route File

Create a route file at `app/api/your-endpoint/route.ts`:

```typescript
// app/api/your-endpoint/route.ts
import { NextRequest, NextResponse } from "next/server"
import { authenticate } from "@/lib/auth/session"
import { audit } from "@/lib/auth/audit"
import { getLiveKitAdapter } from "@/lib/livekit/adapter"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  // Every route outside the public list authenticates first. Sessions live in
  // Postgres, so this is a database read per request — not a middleware check.
  const identity = await authenticate(req.headers)
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  try {
    // Read through the adapter rather than the SDK client directly, so DTOs stay
    // in one place and raw SDK types do not leak into the browser bundle.
    const rooms = await getLiveKitAdapter().listRooms()

    // Mutating or sensitive reads are recorded against the real operator.
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: "room.list",
      targetType: "room",
      targetId: null,
    })

    return NextResponse.json({ rooms })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
```

Public routes, which must authenticate for themselves because callers have no
session yet or are external systems:

| Route | Why it is public |
| --- | --- |
| `POST /api/auth/login` | Mints the session |
| `POST /api/auth/logout` | Idempotent with no session; clears the cookie |
| `GET /api/health` | Liveness for the load balancer |
| `POST /api/webhooks/livekit` | Signed webhook, verified against the API secret |

Request bodies are validated before they reach business logic. A malformed body
is the caller's mistake, so return `400` rather than letting it throw into the
`500` branch — see `app/api/tokens/route.ts` for the pattern.

### Step 2: Create a Hook (Optional)

If the endpoint will be polled, create a custom hook in `hooks/`:

```typescript
// hooks/useYourFeature.ts
'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

const POLLING_INTERVAL = 4000

export function useYourFeature() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchData = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal

    try {
      setError(null)
      const res = await fetch('/api/your-endpoint', { signal })
      if (signal.aborted) return
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      if (!signal.aborted) setData(json.data)
    } catch (err) {
      if (!signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to fetch')
      }
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, POLLING_INTERVAL)
    return () => { clearInterval(interval); abortRef.current?.abort() }
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}
```

## Adding a UI Component

### Using shadcn/ui

Add new UI primitives using the shadcn CLI:

```sh
pnpm dlx shadcn@latest add alert-dialog
pnpm dlx shadcn@latest add dropdown-menu
```

Components are added to `components/ui/` and use the `cn()` utility for class merging.

### Creating Custom Components

Place feature-specific components in their own directory:

```
components/
├── your-feature/
│   ├── your-feature-view.tsx    # Main view
│   ├── your-feature-card.tsx    # Reusable card
│   └── your-feature-form.tsx    # Form component
```

## Styling

### Tailwind CSS v4

This project uses Tailwind CSS v4 with CSS-first configuration:

```css
/* app/globals.css */
@import "tailwindcss";
@import "tw-animate-css";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* ... more theme variables */
}
```

### Using the `cn()` Utility

Merge Tailwind classes with conditional logic:

```tsx
import { cn } from "@/lib/utils"

<div className={cn(
  "base-class padding-4 rounded-lg",
  isActive && "bg-primary text-primary-foreground",
  className  // allow override from props
)} />
```

## Internationalization

### Using Translations

```tsx
import { useI18n } from "@/lib/i18n"

function MyComponent() {
  const { t, locale, dir } = useI18n()
  
  return (
    <div dir={dir}>
      <h1>{t("dashboard.title")}</h1>
      <p>{t("dashboard.subtitle")}</p>
    </div>
  )
}
```

### Adding New Translations

Add keys to both dictionaries in `lib/i18n.tsx`:

```typescript
const en: Dict = {
  // ... existing keys
  "myFeature.title": "My Feature",
  "myFeature.description": "Description of my feature",
}

const fa: Dict = {
  // ... existing keys
  "myFeature.title": "ویژگی من",
  "myFeature.description": "توضیحات ویژگی من",
}
```

### Key Naming Convention

Use dot-notation with feature prefix:

```
feature.section.element  →  "rooms.title", "dashboard.activeRooms"
common.action            →  "common.save", "common.cancel"
nav.item                 →  "nav.dashboard", "nav.rooms"
```

## Data Fetching Patterns

### Polling with AbortController

All data-fetching hooks follow this pattern:

```typescript
const abortRef = useRef<AbortController | null>(null)

const fetchData = useCallback(async () => {
  // 1. Cancel previous request
  abortRef.current?.abort()
  abortRef.current = new AbortController()
  const signal = abortRef.current.signal

  try {
    // 2. Make fetch with signal
    const res = await fetch('/api/endpoint', { signal })
    
    // 3. Check if aborted before updating state
    if (signal.aborted) return
    
    // 4. Update state
    setData(await res.json())
  } catch (err) {
    // 5. Ignore AbortError
    if (err instanceof DOMException && err.name === 'AbortError') return
    setError(err.message)
  }
}, [])

// 6. Initial fetch + polling interval
useEffect(() => {
  fetchData()
  const interval = setInterval(fetchData, INTERVAL)
  return () => { clearInterval(interval); abortRef.current?.abort() }
}, [fetchData])
```

### When to Poll vs. Fetch Once

| Pattern | Use When |
|---------|----------|
| Polling (useRooms, useParticipants) | Data changes frequently (live rooms, participants) |
| Fetch once (useConfig) | Data is static or changes rarely (connection config) |
| On-demand (token generation) | Triggered by user action |

## Environment Variables

### Required Variables

```env
# LiveKit cluster credentials. Anything holding these can create rooms, mint
# participant tokens, and read every room on the deployment.
LIVEKIT_URL=http://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# PostgreSQL: admins, sessions, audit log, webhook events, metrics history.
# Without it there are no accounts, so nothing is reachable.
DATABASE_URL=postgres://livekit:livekit@localhost:5432/livekit_dashboard

# HMAC key for session cookies and webhook signature verification.
# Generate per environment: openssl rand -hex 32
DASHBOARD_SESSION_SECRET=replace-with-a-32-byte-random-hex-string
```

`pnpm dev` refuses to be useful without these three groups: the app serves, but
nothing authenticates.

### Optional Variables

```env
LIVEKIT_REGION=auto

# Prometheus endpoint. When unset, the monitoring and dashboard pages report
# "n/a" for every metric. Nothing is substituted.
LIVEKIT_METRICS_URL=http://localhost:9090/metrics
```

### Adding New Variables

1. Add to `.env.local.example` with a comment explaining what breaks without it
2. Access via `process.env.VARIABLE_NAME`, or add an accessor to `lib/env.ts` when
   the value needs a default
3. Document it in `docs/api-reference.md` if it changes an API response

## Debugging

### Enable Verbose Logging

Add logging to API routes:

```typescript
export async function GET() {
  console.log('Fetching rooms from LiveKit...')
  const rooms = await svc.listRooms()
  console.log(`Found ${rooms.length} rooms`)
  // ...
}
```

### Check LiveKit Connection

`/api/config` reports cluster reachability, but it is authenticated — open it
from a signed-in browser tab, or with a session cookie:

```sh
curl -b cookies.txt http://localhost:3000/api/config
```

```json
{
  "configured": true,
  "url": "http://localhost:7880",
  "hasApiKey": true,
  "hasApiSecret": true,
  "region": "auto",
  "connectionStatus": "connected",
  "roomCount": 3,
  "error": null
}
```

`connectionStatus` is one of `connected`, `error`, `not_configured`, or
`unknown`, and the sidebar status box renders from this response. For a broader
view use `GET /api/health`, which is public and also reports the dashboard's own
Postgres and event-stream state.

### Docker Logs

```sh
cd livekit-server && docker compose logs -f livekit
```

## Testing

```sh
pnpm test          # offline suite
pnpm test:watch    # watch mode
```

The suite runs fully offline by default: `vitest.config.mts` injects placeholder
credentials so token tests can sign JWTs without a cluster or a database.

Two suites opt into real dependencies, and both read your `.env` rather than
placeholders:

```sh
LIVEKIT_E2E=1 pnpm test   # adapter against a running LiveKit server
DB_E2E=1 pnpm test        # event store and snapshots against a real Postgres
```

What to add tests for:

- Grant and claim mapping in `createAccessToken`. Assert on the decoded JWT, not
  on the object passed in, so a grant dropped anywhere before the signature
  fails the test.
- Aggregation and gap semantics in `lib/metrics/store.ts` — in particular that
  an unavailable sample stays `null` and is not bridged.
- Anything where a silent fallback would be worse than a visible error.

## Common Issues

### "LiveKit is not configured"

1. Verify `.env` exists (not just `.env.local.example`)
2. Check that `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` are set
3. Restart the dev server after changing env vars

### CORS Errors

Browser-to-route requests from a different origin need CORS headers. Do **not**
add `Access-Control-Allow-Origin: *` to a dashboard route: every route except
the four public ones authenticates, and a wildcard origin lets any site read
`/api/rooms` or `/api/tokens` for whoever is signed in.

Prefer same-origin deployment (serve the console under the same host as the
dashboard, or reverse-proxy `/api` to it) so no CORS headers are needed at all.

For the genuinely cross-origin case, echo back only origins you control:

```typescript
const ALLOWED_ORIGINS = new Set(["https://console.yourdomain.com"])

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin")
  // Absent origin = same-origin or a non-browser client; nothing to allow.
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  }
}
```

Note that `Access-Control-Allow-Credentials: true` cannot be combined with a
wildcard origin, and the session cookie is `SameSite=Lax`, so a cross-site
credentialed request will not carry it anyway. Cross-origin use is limited to
unauthenticated endpoints until the cookie policy is revisited.

### TypeScript Errors

`next.config.mjs` sets `typescript.ignoreBuildErrors: false`, so `pnpm build`
fails on a type error rather than shipping it. Run `npx tsc --noEmit` for a
faster loop than a full build.

Common issues:

- Missing type definitions for API responses
- `bigint` to `number` conversions
- Optional chaining on SDK types
- Number strings arriving from JSON or the DOM — `creationTimeMs` is a string,
  so it needs `Number(...)` before arithmetic

### Hot Reload Not Working

1. Check that your file is inside the project directory
2. Ensure you're not editing files in `.next/` or `node_modules/`
3. Restart the dev server: `pnpm dev`

## Deployment

### Hosting

This app is not well suited to serverless platforms: every authenticated
request opens a Postgres connection and `GET /api/events` holds an SSE stream
open, which a function with a request timeout will cut. Deploy it as a
long-running Node process with Postgres reachable from it.

Required environment variables:
- `DATABASE_URL`
- `DASHBOARD_SESSION_SECRET` (`openssl rand -hex 32`)
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `LIVEKIT_METRICS_URL` for the monitoring page (leave unset to disable it)

Run `pnpm db:migrate` and `pnpm admin:create` against the target database as a
release step, before starting the new version.

### Docker

Create a `Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["pnpm", "start"]
```

### Environment-Specific Configuration

| Environment | LIVEKIT_URL | Notes |
|-------------|-------------|-------|
| Local dev | `http://localhost:7880` | Docker Compose |
| Staging | `wss://staging.livekit.yourdomain.com` | Test server |
| Production | `wss://livekit.yourdomain.com` | Production server |

## Code Conventions

### File Naming

- Components: `kebab-case.tsx` → `dashboard-view.tsx`
- Hooks: `camelCase.ts` → `useRooms.ts`
- API routes: `route.ts` (Next.js convention)
- Utilities: `kebab-case.ts` → `format-date.ts`

### Import Order

```typescript
// 1. External libraries
import { useState } from 'react'
import { RoomServiceClient } from 'livekit-server-sdk'

// 2. Internal imports (by alias)
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

// 3. Relative imports
import { formatRoomName } from './utils'
```

### Component Structure

```tsx
"use client"

import { useState } from "react"

// Component
export function MyComponent({ prop1, prop2 }: MyComponentProps) {
  // 1. Hooks
  const [state, setState] = useState()
  
  // 2. Event handlers
  function handleClick() { }
  
  // 3. Render
  return <div>...</div>
}
```
