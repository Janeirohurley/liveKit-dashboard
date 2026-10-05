import { describe, expect, it, vi } from 'vitest'
import { publish, subscribe, subscriberCount } from '@/lib/events/bus'

const event = {
  id: 'evt-1',
  event: 'participant_joined',
  createdAt: 1_700_000_000,
  room: 'lobby',
  participant: 'alice',
}

describe('subscribe', () => {
  it('delivers a published event to the subscriber', () => {
    const received: unknown[] = []
    const unsubscribe = subscribe('lobby', (e) => received.push(e))

    publish(event)

    expect(received).toEqual([event])
    unsubscribe()
  })

  it('delivers to an unscoped subscriber as well', () => {
    const all: unknown[] = []
    const scoped: unknown[] = []
    const offAll = subscribe(undefined, (e) => all.push(e))
    const offScoped = subscribe('lobby', (e) => scoped.push(e))

    publish(event)

    expect(all).toHaveLength(1)
    expect(scoped).toHaveLength(1)

    offAll()
    offScoped()
  })

  it('does not leak an event to a subscriber watching another room', () => {
    const received: unknown[] = []
    const off = subscribe('other-room', (e) => received.push(e))

    publish(event)

    expect(received).toHaveLength(0)
    off()
  })

  it('stops delivering after unsubscribe', () => {
    const received: unknown[] = []
    const off = subscribe('lobby', (e) => received.push(e))
    off()

    publish(event)

    expect(received).toHaveLength(0)
  })

  it('delivers to every subscriber of the same room', () => {
    const a: unknown[] = []
    const b: unknown[] = []
    const offA = subscribe('lobby', (e) => a.push(e))
    const offB = subscribe('lobby', (e) => b.push(e))

    publish(event)

    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)

    offA()
    offB()
  })

  it('is idempotent for a subscriber registered twice', () => {
    const received: unknown[] = []
    const listener = (e: unknown) => received.push(e)
    const offA = subscribe('lobby', listener)
    const offB = subscribe('lobby', listener)

    publish(event)

    // A Set keyed on the listener, so one publish is one delivery.
    expect(received).toHaveLength(1)

    offA()
    offB()
  })
})

describe('publish', () => {
  it('contains a throwing subscriber', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const offBad = subscribe('lobby', () => {
      throw new Error('boom')
    })
    const received: unknown[] = []
    const offGood = subscribe('lobby', (e) => received.push(e))

    expect(() => publish(event)).not.toThrow()
    // The good subscriber still receives the event.
    expect(received).toHaveLength(1)

    offBad()
    offGood()
    errorSpy.mockRestore()
  })

  it('is a no-op when nobody is listening', () => {
    expect(() => publish(event)).not.toThrow()
  })

  it('tolerates an event with no room', () => {
    const received: unknown[] = []
    const off = subscribe(undefined, (e) => received.push(e))

    publish({ ...event, room: undefined })

    expect(received).toHaveLength(1)
    off()
  })
})

describe('subscriberCount', () => {
  it('counts subscribers and returns to zero', () => {
    const before = subscriberCount()
    const offA = subscribe('r1', () => {})
    const offB = subscribe('r2', () => {})

    expect(subscriberCount()).toBe(before + 2)

    offA()
    offB()
    expect(subscriberCount()).toBe(before)
  })
})
