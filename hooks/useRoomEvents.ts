'use client'

import { useEffect, useState } from 'react'
import type { StoredWebhookEvent } from '@/lib/events/types'

/**
 * Persisted webhook events for one room.
 *
 * Reads from `/api/events?room=…` rather than the SSE stream: this list is a
 * historical record, and the store already holds it, so there is no reason to
 * buffer events in the browser and lose them on reload.
 */
export function useRoomEvents(roomName: string | undefined): {
  events: StoredWebhookEvent[]
  loading: boolean
} {
  const [events, setEvents] = useState<StoredWebhookEvent[]>([])
  const [loading, setLoading] = useState(Boolean(roomName))

  useEffect(() => {
    if (!roomName) {
      setEvents([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const load = async () => {
      try {
        const res = await fetch(
          `/api/events?room=${encodeURIComponent(roomName)}&limit=50`,
          { signal: controller.signal },
        )
        if (!res.ok) return
        const data = await res.json()
        setEvents(data.events ?? [])
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 10_000)
    return () => {
      clearInterval(interval)
      controller.abort()
    }
  }, [roomName])

  return { events, loading }
}
