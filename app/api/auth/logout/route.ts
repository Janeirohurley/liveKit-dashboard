import { NextRequest, NextResponse } from 'next/server'
import { authenticate, revokeSession, requestContext } from '@/lib/auth/session'
import { audit } from '@/lib/auth/audit'
import { clearSessionCookieHeader } from '@/lib/auth/session-token'

export async function POST(req: NextRequest) {
  const identity = await authenticate(req.headers)
  const ctx = requestContext(req.headers)
  if (identity) {
    await revokeSession(identity.sessionId)
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: 'auth.logout',
      ok: true,
      ip: ctx.ip,
    })
  }
  const res = NextResponse.json({ ok: true })
  res.headers.set('Set-Cookie', clearSessionCookieHeader())
  return res
}
