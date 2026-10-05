import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/session'
import { getLiveKitAdapter } from '@/lib/livekit/adapter'
import { audit } from '@/lib/auth/audit'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const identity = await authenticate(request.headers)
  if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const adapter = getLiveKitAdapter()
    const rooms = await adapter.listRooms()
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: 'room.list',
      targetType: 'room',
      metadata: { count: rooms.length },
    })
    return NextResponse.json({ rooms })
  } catch (_error) {
    return NextResponse.json({ error: 'failed_to_list_rooms' }, { status: 500 })
  }
}

/**
 * Create a room ahead of the first participant.
 *
 * Authenticated and audited: the caller picks the room name, so this lets an
 * authenticated admin pre-provision rooms and set their limits.
 */
export async function POST(request: NextRequest) {
  const identity = await authenticate(request.headers)
  if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { name?: unknown; emptyTimeout?: unknown; departureTimeout?: unknown; maxParticipants?: unknown; metadata?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined

  try {
    const adapter = getLiveKitAdapter()
    const room = await adapter.createRoom({
      name,
      emptyTimeout: num(body.emptyTimeout),
      departureTimeout: num(body.departureTimeout),
      maxParticipants: num(body.maxParticipants),
      metadata: typeof body.metadata === 'string' ? body.metadata : undefined,
    })
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: 'room.create',
      targetType: 'room',
      targetId: name,
    })
    return NextResponse.json({ room }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed_to_create_room' },
      { status: 500 },
    )
  }
}
