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
    const participants = await adapter.listParticipants(name)
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: 'participant.list',
      targetType: 'room',
      targetId: name,
      metadata: { count: participants.length },
    })
    return NextResponse.json({ participants })
  } catch (_error) {
    return NextResponse.json({ error: 'failed_to_list_participants' }, { status: 500 })
  }
}
