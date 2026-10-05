import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/session'
import { audit } from '@/lib/auth/audit'
import {
  clearWebhookEvents,
  listWebhookEvents,
  listWebhookFacets,
} from '@/lib/webhook-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseLimit(raw: string | null, fallback: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), 1), 1000)
}

export async function GET(req: NextRequest) {
  const identity = await authenticate(req.headers)
  if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const limit = parseLimit(url.searchParams.get('limit'), 100)
  const room = url.searchParams.get('room') ?? undefined
  const eventType = url.searchParams.get('type') ?? undefined
  const participant = url.searchParams.get('participant') ?? undefined
  const sinceRaw = url.searchParams.get('since')
  const since = sinceRaw === null ? undefined : Number(sinceRaw)

  try {
    // Room and event type are indexed columns, so they filter in SQL.
    let events = await listWebhookEvents({
      limit,
      room,
      event: eventType && eventType !== 'all' ? eventType : undefined,
    })

    // Participant and since have no index; filtering here keeps the schema
    // small at the cost of reading up to `limit` rows.
    if (participant) events = events.filter((e) => e.participant === participant)
    if (since !== undefined && Number.isFinite(since)) {
      events = events.filter((e) => e.createdAt >= since)
    }

    const facets = await listWebhookFacets()

    return NextResponse.json({
      events,
      filters: {
        rooms: facets.rooms,
        participants: [...new Set(events.map((e) => e.participant).filter(Boolean))] as string[],
        eventTypes: facets.eventTypes,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed_to_list_events' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const identity = await authenticate(req.headers)
  if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const deleted = await clearWebhookEvents()
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: 'events.clear',
      targetType: 'event',
      metadata: { deleted },
    })
    return NextResponse.json({ ok: true, deleted })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed_to_clear_events' },
      { status: 500 },
    )
  }
}
