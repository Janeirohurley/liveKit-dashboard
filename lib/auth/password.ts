/**
 * Password hashing with scrypt (node:crypto).
 *
 * No dependency: scrypt is the memory-hard KDF already in the runtime, so
 * there is no native module to build and no third-party crypto to trust.
 *
 * Stored format: `scrypt$N$r$p$<salt-b64>$<hash-b64>` — the parameters travel
 * with the hash so they can be raised later without invalidating old rows.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const PARAMS = { N: 32_768, r: 8, p: 1 } as const
const SALT_BYTES = 16
const KEY_BYTES = 32

/**
 * scrypt needs roughly 128 * N * r bytes. Node's default 32 MB cap is below
 * that for N=32768,r=8 (33.5 MB), which would throw, so raise it explicitly.
 * Cost stays modest enough for an interactive login on a small VPS.
 */
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2

export const MIN_PASSWORD_LENGTH = 6

export async function hashPassword(password: string): Promise<string> {
  assertAcceptable(password)
  const salt = randomBytes(SALT_BYTES)
  const key = await scryptAsync(password, salt, KEY_BYTES, { ...PARAMS, maxmem: MAXMEM })
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$')
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false — never throws — on a malformed or truncated hash, so a
 * corrupted row denies access instead of crashing the login route.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  // Refuse absurd parameters from a tampered row rather than allocating on them.
  if (N < 2 || r < 1 || p < 1 || N > 1_048_576 || r > 32 || p > 16) return false

  let expected: Buffer
  let salt: Buffer
  try {
    salt = Buffer.from(parts[4], 'base64')
    expected = Buffer.from(parts[5], 'base64')
    if (salt.length === 0 || expected.length === 0) return false
  } catch {
    return false
  }

  let actual: Buffer
  try {
    actual = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    })
  } catch {
    return false
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function assertAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters ` +
        `(got ${password.length}). This dashboard holds admin credentials.`,
    )
  }
}
