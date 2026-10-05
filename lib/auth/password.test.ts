import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
} from '@/lib/auth/password'

const PASSWORD = 'correct-horse-battery-staple'

describe('hashPassword', () => {
  it('round-trips a valid password', async () => {
    const stored = await hashPassword(PASSWORD)
    expect(stored.startsWith('scrypt$')).toBe(true)
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(true)
  })

  it('rejects a wrong password', async () => {
    const stored = await hashPassword(PASSWORD)
    await expect(verifyPassword(`${PASSWORD}-x`, stored)).resolves.toBe(false)
  })

  it('salts, so two hashes of the same password differ', async () => {
    const a = await hashPassword(PASSWORD)
    const b = await hashPassword(PASSWORD)
    expect(a).not.toBe(b)
  })

  it('refuses passwords below the minimum length', async () => {
    await expect(hashPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow()
  })

  it('accepts a password at exactly the minimum length', async () => {
    const pw = 'a'.repeat(MIN_PASSWORD_LENGTH)
    const stored = await hashPassword(pw)
    await expect(verifyPassword(pw, stored)).resolves.toBe(true)
  })
})

describe('verifyPassword', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['no separators', 'garbage'],
    ['wrong algorithm', 'argon2$1$2$3$aaaa$bbbb'],
    ['truncated', 'scrypt$32768$8$1$aaaa'],
  ])('returns false instead of throwing on a malformed hash (%s)', async (_label, stored) => {
    await expect(verifyPassword(PASSWORD, stored as unknown as string)).resolves.toBe(false)
  })
})
