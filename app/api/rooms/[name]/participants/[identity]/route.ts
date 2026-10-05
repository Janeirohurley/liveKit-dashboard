import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/session'
import { getLiveKitAdapter } from '@/lib/livekit/adapter'
import { audit } from '@/lib/auth/audit'

export const runtime = 'nodejs'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ name: string; identity: string }> }
) {
  const { name, identity } = await context.params
  const id = identity
  const auth = await authenticate(request.headers)
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const adapter = getLiveKitAdapter()
    await adapter.removeParticipant(name, id)
    await audit({
      adminId: auth.id,
      adminEmail: auth.email,
      action: 'participant.kick',
      targetType: 'participant',
      targetId: id,
      metadata: { room: name },
    })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'failed_to_kick_participant' }, { status: 500 })
  }
}
