import { NextRequest, NextResponse } from 'next/server'
import { verifyCredentials, createSession, requestContext } from '@/lib/auth/session'
import { audit } from '@/lib/auth/audit'
import { sessionCookieHeader, sessionTtlSeconds } from '@/lib/auth/session-token'

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const email = String(body.email ?? '').trim()
  const password = String(body.password ?? '')
  if (!email || !password) {
    return NextResponse.json({ error: 'missing_credentials' }, { status: 400 })
  }

  // Only an explicit true counts, so a missing or malformed field means the
  // short idle window rather than a silently long-lived session.
  const remember = body.remember === true

  const ctx = requestContext(req.headers)
  const admin = await verifyCredentials(email, password)
  if (!admin) {
    await audit({
      adminId: null,
      adminEmail: email,
      action: 'auth.login_failed',
      metadata: { reason: 'invalid_credentials' },
      ok: false,
      ip: ctx.ip,
    })
    return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
  }

  const { cookieValue } = await createSession(admin, ctx, remember)
  await audit({
    adminId: admin.id,
    adminEmail: admin.email,
    action: 'auth.login',
    ok: true,
    ip: ctx.ip,
  })

  const res = NextResponse.json({
    ok: true,
    user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
  })
  res.headers.set('Set-Cookie', sessionCookieHeader(cookieValue, sessionTtlSeconds(remember)))
  return res
}
