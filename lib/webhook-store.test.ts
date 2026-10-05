import { afterAll, describe, expect, it } from 'vitest'
import {
  clearWebhookEvents,
  listWebhookEvents,
  listWebhookFacets,
  pruneWebhookEvents,
  recordWebhookEvent,
} from '@/lib/webhook-store'

/**
 * These run against the developer's Postgres because the store has no seam to
 * substitute a fake connection. Skipped when DATABASE_URL is absent so a
 * contributor without a database still gets a green suite.
 */
const hasDb = Boolean(process.env.DATABASE_URL)

const now = Math.floor(Date.now() / 1000)

function evt(overrides: Partial<Parameters<typeof recordWebhookEvent>[0]> = {}) {
  return {
    id: crypto.randomUUID(),
    event: 'participant_joined',
    createdAt: now,
    room: 'test-room',
    participant: 'alice',
    raw: { event: 'participant_joined' },
    ...overrides,
  }
}

describe.runIf(hasDb)('webhook-store', () => {
  afterAll(async () => {
    await clearWebhookEvents()
  })

  it('records and reads back an event', async () => {
    const input = evt({ event: 'room_started', room: 'persist-room' })
    expect(await recordWebhookEvent(input)).toBe(true)

    const events = await listWebhookEvents({ room: 'persist-room' })
    const found = events.find((e) => e.id === input.id)

    expect(found).toBeDefined()
    expect(found?.event).toBe('room_started')
    expect(found?.createdAt).toBe(input.createdAt)
    expect(found?.participant).toBe('alice')
  })

  it('preserves optional fields as undefined when absent', async () => {
    const input = evt({
      event: 'room_finished',
      room: 'sparse-room',
      participant: undefined,
      trackSid: undefined,
    })
    await recordWebhookEvent(input)

    const [found] = await listWebhookEvents({ room: 'sparse-room' })
    expect(found?.participant).toBeUndefined()
    expect(found?.trackSid).toBeUndefined()
  })

  it('is idempotent for a repeated event id', async () => {
    const input = evt({ event: 'track_published', room: 'dupe-room' })
    await recordWebhookEvent(input)
    await recordWebhookEvent(input)

    const events = await listWebhookEvents({ room: 'dupe-room' })
    expect(events.filter((e) => e.id === input.id)).toHaveLength(1)
  })

  it('orders newest first', async () => {
    const room = 'order-room'
    await recordWebhookEvent(evt({ room, createdAt: now - 100, event: 'older' }))
    await recordWebhookEvent(evt({ room, createdAt: now, event: 'newer' }))

    const events = await listWebhookEvents({ room })
    expect(events[0]?.event).toBe('newer')
  })

  it('filters by event type', async () => {
    const room = 'type-room'
    await recordWebhookEvent(evt({ room, event: 'room_started' }))
    await recordWebhookEvent(evt({ room, event: 'room_finished' }))

    const events = await listWebhookEvents({ room, event: 'room_finished' })
    expect(events.every((e) => e.event === 'room_finished')).toBe(true)
  })

  it('clamps the limit into range', async () => {
    const room = 'limit-room'
    for (let i = 0; i < 5; i++) {
      await recordWebhookEvent(evt({ room, createdAt: now + i }))
    }
    expect((await listWebhookEvents({ room, limit: 0 })).length).toBeGreaterThan(0)
    expect((await listWebhookEvents({ room, limit: 10_000 })).length).toBeLessThanOrEqual(1000)
  })

  it('returns distinct facets', async () => {
    await recordWebhookEvent(evt({ room: 'facet-a' }))
    await recordWebhookEvent(evt({ room: 'facet-b' }))
    await recordWebhookEvent(evt({ event: 'egress_started', room: 'facet-b' }))

    const facets = await listWebhookFacets()
    expect(facets.rooms).toContain('facet-a')
    expect(new Set(facets.rooms).size).toBe(facets.rooms.length)
    expect(facets.eventTypes).toContain('egress_started')
  })

  it('prunes only events older than the retention window', async () => {
    const old = evt({ room: 'old-room', createdAt: now - 40 * 86400 })
    const fresh = evt({ room: 'fresh-room', createdAt: now })
    await recordWebhookEvent(old)
    await recordWebhookEvent(fresh)

    const deleted = await pruneWebhookEvents(14)

    expect(deleted).toBeGreaterThanOrEqual(1)
    const remaining = await listWebhookEvents({ limit: 1000 })
    expect(remaining.some((e) => e.id === old.id)).toBe(false)
    expect(remaining.some((e) => e.id === fresh.id)).toBe(true)
  })

  it('clears events', async () => {
    await recordWebhookEvent(evt({ room: 'clear-room' }))
    await clearWebhookEvents()

    const remaining = await listWebhookEvents({ limit: 1000 })
    expect(remaining).toHaveLength(0)
  })
})
