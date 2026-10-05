'use client'

import { useEffect, useRef, useState } from 'react'
import type { StoredWebhookEvent } from '@/lib/events/types'

/**
 * Live webhook feed over SSE, with polling as the fallback.
 *
 * SSE alone is not sufficient: a proxy or an offline laptop silently drops the
 * stream, and the UI would then look "quiet" rather than "broken". Polling
 * continues alongside the stream so a dropped connection self-heals within one
 * interval, and `connected` is surfaced so the operator can see the difference
 * between a quiet room and a dead stream.
 */

const POLL_MS = 10_000
const MAX_CLIENT_EVENTS = 500

interface UseEventStreamReturn {
  events: StoredWebhookEvent[]
  connected: boolean
}

export function useEventStream(room: string): UseEventStreamReturn {
  const [events, setEvents] = useState<StoredWebhookEvent[]>([])
  const [connected, setConnected] = useState(false)
  // Read inside the stream handler without re-opening the connection on every
  // filter change.
  const roomRef = useRef(room)
  roomRef.current = room

  useEffect(() => {
    const source = new EventSource(
      `/api/stream${room && room !== 'all' ? `?room=${encodeURIComponent(room)}` : ''}`,
    )

    source.addEventListener('ready', () => setConnected(true))

    source.addEventListener('webhook', (message) => {
      try {
        const parsed = JSON.parse((message as MessageEvent).data) as StoredWebhookEvent
        setEvents((prev) => {
          if (prev.some((e) => e.id === parsed.id)) return prev
          const next = [parsed, ...prev]
          return next.length > MAX_CLIENT_EVENTS ? next.slice(0, MAX_CLIENT_EVENTS) : next
        })
      } catch (err) {
        console.error('Failed to parse streamed event', err)
      }
    })

    source.onerror = () => setConnected(false)

    return () => source.close()
  }, [room])

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const params = new URLSearchParams()
        params.set('limit', '300')
        const current = roomRef.current
        if (current && current !== 'all') params.set('room', current)
        const res = await fetch(`/api/events?${params}`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        const fromDb = (data.events ?? []) as StoredWebhookEvent[]
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          const merged = [...prev, ...fromDb.filter((e) => !seen.has(e.id))]
          merged.sort((a, b) => b.createdAt - a.createdAt)
          return merged.length > MAX_CLIENT_EVENTS ? merged.slice(0, MAX_CLIENT_EVENTS) : merged
        })
      } catch (err) {
        console.error('Event poll failed', err)
      }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return { events, connected }
}
