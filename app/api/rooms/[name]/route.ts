import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/session'
import { getLiveKitAdapter } from '@/lib/livekit/adapter'
import { audit } from '@/lib/auth/audit'

export const runtime = 'nodejs'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> }
) {
  const { name } = await context.params
  const identity = await authenticate(request.headers)
  if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const adapter = getLiveKitAdapter()
    const room = await adapter.getRoom(name)
    if (!room) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: 'room.get',
      targetType: 'room',
      targetId: room.name,
    })
    return NextResponse.json({ room })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed_to_get_room' },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ name: string }> }
) {
  const { name } = await context.params
  const identity = await authenticate(request.headers)
  if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const adapter = getLiveKitAdapter()
    // LiveKit returns NOT_FOUND for a room that already ended on its own, and
    // the caller's intent is satisfied either way. Report that as 404 rather than
    // a 500 so the UI can tell "gone" from "the cluster is unreachable".
    if (!(await adapter.getRoom(name))) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    await adapter.deleteRoom(name)
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: 'room.delete',
      targetType: 'room',
      targetId: name,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed_to_delete_room' },
      { status: 500 },
    )
  }
}
