import { beforeEach, describe, expect, it } from 'vitest'
import {
  createSessionToken,
  readSessionToken,
  SESSION_MAX_SECONDS,
} from '@/lib/auth/session-token'

const FUTURE = Date.now() + 60_000

beforeEach(() => {
  // The token helpers read the signing secret from env on each call, so no
  // stubbing is required; each test asserts on shape and tamper detection.
})

describe('createSessionToken', () => {
  it('produces a readable token', () => {
    const { value, session } = createSessionToken()
    expect(value.split('.')).toHaveLength(3)
    expect(session.issuedAtMs).toBeGreaterThan(0)
  })

  it('issues a distinct session id every time', () => {
    const ids = new Set(Array.from({ length: 25 }, () => createSessionToken().session.sessionId))
    expect(ids.size).toBe(25)
  })
})

describe('readSessionToken', () => {
  it('round-trips a freshly issued token', () => {
    const { value, session } = createSessionToken()
    const parsed = readSessionToken(value)
    expect(parsed?.sessionId).toBe(session.sessionId)
    expect(parsed?.issuedAtMs).toBe(session.issuedAtMs)
  })

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['one part', 'abc'],
    ['two parts', 'abc.def'],
    ['four parts', 'a.b.c.d'],
    ['non-numeric timestamp', 'abc.notanumber.sig'],
  ])('rejects a malformed token (%s)', (_label, value) => {
    expect(readSessionToken(value)).toBeNull()
  })

  it('rejects a tampered session id', () => {
    const { value } = createSessionToken()
    const [id, issuedAt, sig] = value.split('.')
    const tampered = `${id}x.${issuedAt}.${sig}`
    expect(readSessionToken(tampered)).toBeNull()
  })

  it('rejects a tampered timestamp', () => {
    const { value } = createSessionToken()
    const [id, issuedAt, sig] = value.split('.')
    const tampered = `${id}.${Number(issuedAt) + 1000}.${sig}`
    expect(readSessionToken(tampered)).toBeNull()
  })

  it('rejects a garbage signature of the right length', () => {
    const { value } = createSessionToken()
    const [id, issuedAt] = value.split('.')
    const tampered = `${id}.${issuedAt}.${'A'.repeat(43)}`
    expect(readSessionToken(tampered)).toBeNull()
  })

  it('rejects an expired token', () => {
    const { value } = createSessionToken()
    const [id, issuedAt, sig] = value.split('.')
    const stale = Number(issuedAt) - (SESSION_MAX_SECONDS + 60) * 1000
    expect(readSessionToken(`${id}.${stale}.${sig}`)).toBeNull()
  })

  it('rejects a token issued far in the future', () => {
    const { value } = createSessionToken()
    const [id, issuedAt, sig] = value.split('.')
    const ahead = Number(issuedAt) + 10 * 60 * 1000
    expect(readSessionToken(`${id}.${ahead}.${sig}`)).toBeNull()
  })

  it('accepts a slightly skewed clock within the tolerance', () => {
    const { value } = createSessionToken()
    const [id, issuedAt, sig] = value.split('.')
    const slightlyAhead = Number(issuedAt) + 30 * 1000
    expect(readSessionToken(`${id}.${slightlyAhead}.${sig}`)).toBeNull()
    expect(readSessionToken(`${id}.${issuedAt}.${sig}`)).not.toBeNull()
    expect(FUTURE).toBeGreaterThan(Date.now())
  })
})
