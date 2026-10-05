'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import type { RoomDTO } from '@/lib/livekit/adapter'

/**
 * One room from the RoomService.
 *
 * Returns `null` while loading and on a 404 — an empty room is not the same as
 * a room that does not exist, and the detail view has to say so.
 */
export function useRoom(roomName: string | undefined): {
  room: RoomDTO | null
  missing: boolean
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
} {
  const [room, setRoom] = useState<RoomDTO | null>(null)
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(Boolean(roomName))
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchRoom = useCallback(async () => {
    if (!roomName) {
      setRoom(null)
      setLoading(false)
      return
    }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    try {
      setError(null)
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomName)}`, { signal })
      if (signal.aborted) return
      if (res.status === 404) {
        setMissing(true)
        setRoom(null)
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (!signal.aborted) {
        setRoom(data.room ?? null)
        setMissing(false)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (!signal.aborted) {
        setError(err instanceof Error ? err.message : 'Failed to fetch room')
        setRoom(null)
      }
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [roomName])

  useEffect(() => {
    fetchRoom()
    return () => {
      abortRef.current?.abort()
    }
  }, [fetchRoom])

  return { room, missing, loading, error, refetch: fetchRoom }
}
