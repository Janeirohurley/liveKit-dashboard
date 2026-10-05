/**
 * In-process pub/sub for pushing webhook events to open SSE connections.
 *
 * Scope is deliberate: this fan-out exists to avoid a 3-second poll on every
 * log viewer, not to guarantee delivery. A subscriber that misses an event
 * still converges, because `/api/events` reads the same Postgres rows — the
 * stream is an optimisation over polling, never the source of truth. That is
 * why the buffer is per-process and why nothing depends on it for
 * correctness.
 *
 * On a multi-instance deployment each process only sees its own webhooks.
 * Subscribers would need sticky routing, or a shared bus (Postgres LISTEN/
 * NOTIFY, Redis). Until then, correctness comes from the persisted log.
 */

export type StreamEvent = {
  id: string
  event: string
  createdAt: number
  room?: string
  participant?: string
  trackSid?: string
  egressId?: string
}

type Listener = (event: StreamEvent) => void

// Cached on globalThis so Next.js dev HMR does not drop every subscriber and
// orphan their response streams.
const globalForBus = globalThis as unknown as { __lkdStreamBus?: Map<string, Set<Listener>> }

function bus(): Map<string, Set<Listener>> {
  if (!globalForBus.__lkdStreamBus) globalForBus.__lkdStreamBus = new Map()
  return globalForBus.__lkdStreamBus
}

/**
 * Subscribe to events for one room, or for all events when `room` is omitted.
 * Returns an unsubscribe function; always call it when the stream closes.
 */
export function subscribe(room: string | undefined, listener: Listener): () => void {
  const key = room ?? '*'
  const listeners = bus().get(key) ?? new Set<Listener>()
  listeners.add(listener)
  bus().set(key, listeners)
  return () => {
    const current = bus().get(key)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) bus().delete(key)
  }
}

/** Deliver an event to every matching subscriber. Listener errors are contained. */
export function publish(event: StreamEvent): void {
  const all = bus().get('*')
  if (all) {
    for (const listener of all) {
      try {
        listener(event)
      } catch (error) {
        console.error('[stream] subscriber threw', error)
      }
    }
  }

  if (!event.room) return
  const scoped = bus().get(event.room)
  if (!scoped) return
  for (const listener of scoped) {
    try {
      listener(event)
    } catch (error) {
      console.error('[stream] scoped subscriber threw', error)
    }
  }
}

/** Current subscriber count, for the health endpoint and tests. */
export function subscriberCount(): number {
  let total = 0
  for (const listeners of bus().values()) total += listeners.size
  return total
}
