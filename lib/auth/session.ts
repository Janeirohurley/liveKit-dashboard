/**
 * Database-backed session lifecycle and the `authenticate()` entry point that
 * every route and server component uses.
 */

import { getDb } from '@/lib/db'
import { SESSION_COOKIE } from '@/lib/auth/session-token'
import {
  createSessionToken,
  isExpired,
  readSessionToken,
  sessionTtlSeconds,
  SESSION_TTL_SECONDS,
} from '@/lib/auth/session-token'

export type Role = 'admin' | 'viewer'

export interface AdminIdentity {
  id: string
  email: string
  name: string
  role: Role
  sessionId: string
}

interface AdminRow {
  id: string
  email: string
  name: string
  role: Role
  token_version: number
  disabled_at: Date | null
  password_hash?: string
}

interface SessionRow extends AdminRow {
  expires_at: Date
  revoked_at: Date | null
  session_token_version: number
  ttl_seconds: number | null
}

/** Older rows predate the ttl column; fall back to the long default. */
function idleSeconds(row: SessionRow): number {
  return typeof row.ttl_seconds === 'number' && row.ttl_seconds > 0
    ? row.ttl_seconds
    : SESSION_TTL_SECONDS
}

export interface RequestContext {
  ip: string | null
  userAgent: string | null
}

/**
 * Read the client IP from the headers a reverse proxy sets.
 *
 * `x-forwarded-for` is client-controllable, so it is only trustworthy behind a
 * proxy that overwrites it. It feeds the audit log, never an authorization
 * decision.
 */
export function requestContext(headers: Headers): RequestContext {
  const forwarded = headers.get('x-forwarded-for')
  const ip =
    (forwarded?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || null) ??
    null
  return { ip, userAgent: headers.get('user-agent')?.trim() ?? null }
}

function readCookie(headers: Headers, name: string): string | undefined {
  const raw = headers.get('cookie')
  if (!raw) return undefined
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

/**
 * Resolve the caller from the session cookie.
 *
 * Returns null when: no cookie, bad signature, unknown session, revoked
 * session, expired session, disabled account, or a token_version mismatch
 * (i.e. the password changed since the session was issued).
 */
export async function authenticate(headers: Headers): Promise<AdminIdentity | null> {
  const token = readSessionToken(readCookie(headers, SESSION_COOKIE))
  if (!token) return null

  const sql = await getDb()
  const rows = await sql<SessionRow[]>`
    select s.expires_at, s.revoked_at, s.token_version as session_token_version,
           s.ttl_seconds,
           a.id, a.email, a.name, a.role, a.token_version, a.disabled_at
      from dashboard_sessions s
      join dashboard_admins a on a.id = s.admin_id
     where s.id = ${token.sessionId}
  `
  const row = rows[0]
  if (!row) return null
  if (row.revoked_at) return null
  if (isExpired(row.expires_at)) return null
  if (row.disabled_at) return null
  if (row.session_token_version !== row.token_version) return null

  // Sliding renewal: push expiry forward so continuous use is not interrupted.
  // The window is the one chosen at sign-in, so unticking "remember me" keeps
  // working right up to the shorter idle timeout instead of being revived.
  const renewed = new Date(Date.now() + idleSeconds(row) * 1000)
  await sql`
    update dashboard_sessions
       set last_seen_at = now(), expires_at = ${renewed}
     where id = ${token.sessionId}
  `

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    sessionId: token.sessionId,
  }
}

export interface CreatedSession {
  cookieValue: string
  sessionId: string
}

export async function createSession(
  admin: { id: string; token_version: number },
  ctx: RequestContext,
  remember = false,
): Promise<CreatedSession> {
  const { value, session } = createSessionToken()
  const sql = await getDb()
  const ttl = sessionTtlSeconds(remember)
  const expiresAt = new Date(Date.now() + ttl * 1000)
  await sql`
    insert into dashboard_sessions
      (id, admin_id, token_version, expires_at, ip, user_agent, ttl_seconds)
    values
      (${session.sessionId}, ${admin.id}, ${admin.token_version},
       ${expiresAt}, ${ctx.ip}, ${ctx.userAgent}, ${ttl})
  `
  return { cookieValue: value, sessionId: session.sessionId }
}

export async function revokeSession(sessionId: string): Promise<void> {
  const sql = await getDb()
  await sql`
    update dashboard_sessions set revoked_at = now()
     where id = ${sessionId} and revoked_at is null
  `
}

export async function revokeAllSessionsForAdmin(adminId: string): Promise<void> {
  const sql = await getDb()
  await sql`
    update dashboard_sessions set revoked_at = now()
     where admin_id = ${adminId} and revoked_at is null
  `
}

/**
 * Verify credentials.
 *
 * Returns the stored account on success and null otherwise. On an unknown
 * email a dummy scrypt hash is still computed so the response time does not
 * reveal whether the account exists.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<{ id: string; email: string; name: string; role: Role; token_version: number } | null> {
  const sql = await getDb()
  const rows = await sql<AdminRow[]>`
    select id, email, name, role, token_version, disabled_at, password_hash
      from dashboard_admins
     where email = ${email.toLowerCase().trim()}
  `
  const row = rows[0]

  if (!row) {
    const { verifyPassword } = await import('@/lib/auth/password')
    await verifyPassword(password, DUMMY_HASH)
    return null
  }
  if (row.disabled_at) return null

  const { verifyPassword } = await import('@/lib/auth/password')
  if (!row.password_hash) return null
  if (!(await verifyPassword(password, row.password_hash))) return null
  return row
}

/**
 * Valid scrypt hash of an unguessable value, used only to equalize timing on
 * the unknown-email path. Generated once at module load (~100 ms of CPU).
 */
const DUMMY_HASH = [
  'scrypt',
  32_768,
  8,
  1,
  'AAAAAAAAAAAAAAAAAAAAAA==',
  'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ8=',
].join('$')
