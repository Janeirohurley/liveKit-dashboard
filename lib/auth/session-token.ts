/**
 * Session cookies: an HMAC-signed opaque token backed by a database row.
 *
 * Shape: `<sessionId>.<issuedAtMs>.<hmac>`
 *
 * Why both a signature and a row:
 *   - the HMAC makes a forged id fail fast, with no database round trip;
 *   - the row makes revocation real. Logout sets `revoked_at`, and a password
 *     change bumps `admin.token_version`, which invalidates every outstanding
 *     session at once. Neither is possible with a stateless token alone.
 *
 * The signing key never leaves the server, and the cookie is HttpOnly +
 * SameSite=Lax so it is neither readable nor auto-sent from another origin.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { sessionSecret } from '@/lib/env'

export const SESSION_COOKIE = 'lkd_session'

export const SESSION_TTL_SECONDS = 60 * 60 * 8

/**
 * Idle window when the operator does not tick "remember me".
 *
 * Sliding renewal in `authenticate()` keeps this alive while requests keep
 * arriving, so this is an inactivity timeout rather than a total session
 * length: walk away for 30 minutes and the session is gone, but an operator
 * actively working is not logged out mid-task.
 */
export const SESSION_IDLE_SECONDS = 60 * 30

/** Grant a remembered session the long idle window instead. */
export function sessionTtlSeconds(remember: boolean): number {
  return remember ? SESSION_TTL_SECONDS : SESSION_IDLE_SECONDS
}

/**
 * Generous absolute lifetime. Sliding renewal happens in `readSession` by
 * pushing `expires_at` forward while the row stays active, so an operator
 * working continuously is not logged out mid-session.
 */
export const SESSION_MAX_SECONDS = 60 * 60 * 24 * 7

export interface SessionToken {
  sessionId: string
  issuedAtMs: number
}

function hmacFor(sessionId: string, issuedAtMs: number, key: string): string {
  return createHmac('sha256', key)
    .update(`${sessionId}.${issuedAtMs}`)
    .digest('base64url')
}

export function createSessionToken(): { value: string; session: SessionToken } {
  const sessionId = randomBytes(24).toString('base64url')
  const issuedAtMs = Date.now()
  const value = `${sessionId}.${issuedAtMs}.${hmacFor(sessionId, issuedAtMs, sessionSecret())}`
  return { value, session: { sessionId, issuedAtMs } }
}

/**
 * Verify signature and expiry.
 *
 * Returns null for anything suspect — bad shape, bad signature, or expired —
 * so callers have a single "not authenticated" path.
 */
export function readSessionToken(value: string | undefined): SessionToken | null {
  if (!value) return null

  const parts = value.split('.')
  if (parts.length !== 3) return null

  const [sessionId, issuedAtRaw, signature] = parts
  const issuedAtMs = Number(issuedAtRaw)
  if (!sessionId || !Number.isFinite(issuedAtMs)) return null

  const expected = Buffer.from(hmacFor(sessionId, issuedAtMs, sessionSecret()))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null

  const ageSeconds = (Date.now() - issuedAtMs) / 1000
  if (ageSeconds < -60) return null // issued in the future: tampered clock
  if (ageSeconds > SESSION_MAX_SECONDS) return null

  return { sessionId, issuedAtMs }
}

export function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now()
}

/** Cookie attributes shared by every write. */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.NODE_ENV === 'production',
} as const

export function sessionCookieHeader(value: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    `Path=${SESSION_COOKIE_OPTIONS.path}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (SESSION_COOKIE_OPTIONS.secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookieHeader(): string {
  return sessionCookieHeader('', 0)
}
