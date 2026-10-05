"use client"

import { useEffect, useState, useCallback, useRef } from 'react'

/**
 * Shared monitoring feed.
 *
 * One poll feeds the dashboard and the monitoring page, so opening both tabs
 * does not double the scrape load. Values arrive null when the source does not
 * report them; the hook passes those through untouched rather than substituting
 * defaults, because "not reported" and "zero" mean different things during an
 * incident.
 */

// A type alias, not an interface: chart points carry an open field set, and
// TypeScript only infers an implicit index signature for aliases.
export type HistoryPoint = {
  at: string
  rooms: number | null
  participants: number | null
  packetsOut: number | null
  packetsDropped: number | null
  packetLossRatio: number | null
  qualityScore: number | null
  latencyMs: number | null
  cpuSecondsTotal: number | null
  residentMemoryBytes: number | null
  webhooksFailed: number | null
}

export interface MonitoringPayload {
  rooms: { total: number; active: number }
  participants: { total: number; publishers: number; avgPerRoom: number }
  capacity: { max: number; utilization: number | null }
  recordings: {
    active: number
    egress: Array<{ id: string; roomName: string | null; status: string | null; startedAt: string | null }>
  }
  roomDetails: Array<{
    name: string
    sid: string
    participants: number
    publishers: number
    maxParticipants: number
    recording: boolean
    createdAt: string | null
    metadata: string
  }>
  system: {
    available: boolean
    error: string | null
    cpuPercent: number | null
    ramBytes: number | null
    heapBytes: number | null
    goroutines: number | null
    openFds: number | null
    uptimeSeconds: number | null
    networkRxBytes: number | null
    networkTxBytes: number | null
    host: null
  }
  webrtc: {
    jitterSeconds: number | null
    latencyMsAvg: number | null
    latencyMsP95: number | null
    packetLossRatio: number | null
    packetsOut: number | null
    packetsDropped: number | null
  }
  quality: { scoreAvg: number | null; scoreCount: number }
  webhooks: { dispatched: number; failed: number; queueLengthAvg: number | null }
  history: HistoryPoint[]
  collectedAt: string
}

const POLL_INTERVAL = 5_000

export function useMonitoring(): {
  data: MonitoringPayload | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const [data, setData] = useState<MonitoringPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    try {
      setError(null)
      const res = await fetch('/api/monitoring', { signal })
      if (signal.aborted) return
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const payload: MonitoringPayload = await res.json()
      if (!signal.aborted) setData(payload)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (!signal.aborted) setError(err instanceof Error ? err.message : 'Failed to fetch monitoring data')
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL)
    return () => {
      clearInterval(interval)
      abortRef.current?.abort()
    }
  }, [refresh])

  return { data, loading, error, refresh }
}
