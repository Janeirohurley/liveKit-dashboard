import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/session'
import { getLiveKitAdapter } from '@/lib/livekit/adapter'
import { audit } from '@/lib/auth/audit'

export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ name: string; identity: string; trackSid: string }> }
) {
  const { name, identity, trackSid } = await context.params
  const auth = await authenticate(request.headers)
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const muted = body?.muted === true

  try {
    const adapter = getLiveKitAdapter()
    await adapter.mutePublishedTrack(name, identity, trackSid, muted)
    await audit({
      adminId: auth.id,
      adminEmail: auth.email,
      action: 'track.mute',
      targetType: 'track',
      targetId: trackSid,
      metadata: { room: name, identity, muted },
    })
    return NextResponse.json({ success: true })
  } catch (_error) {
    return NextResponse.json({ error: 'failed_to_mute_track' }, { status: 500 })
  }
}
