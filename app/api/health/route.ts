import { NextResponse } from 'next/server'
import { getLiveKitAdapter } from '@/lib/livekit/adapter'
import { subscriberCount } from '@/lib/events/bus'
import { isDatabaseConfigured } from '@/lib/env'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Liveness for the dashboard's own backing services.
 *
 * Distinct from the LiveKit server's health: this reports what the dashboard
 * can reach, so "the UI is empty" can be attributed to a broken LiveKit server
 * rather than a broken event pipeline.
 *
 * Returns 200 even when a dependency is down, because the dashboard itself is
 * still serving — a load balancer restarting it would not help. `ok` carries
 * the verdict for the caller to act on.
 */
export async function GET() {
  const adapter = getLiveKitAdapter()
  const livekit = await adapter.health()

  const events = {
    storeConfigured: isDatabaseConfigured(),
    streamSubscribers: subscriberCount(),
  }

  return NextResponse.json({
    ok: livekit.ok && events.storeConfigured,
    livekit,
    events,
    checkedAt: new Date().toISOString(),
  })
}
