/**
 * LiveKit metrics collection.
 *
 * Reads the Prometheus endpoint that a livekit-server exposes on
 * `--prometheus.port` (enabled in livekit-server/docker-compose.yaml) and
 * reduces it to a typed snapshot. Everything here is measured, not modelled:
 * a metric the server does not export is `null` in the snapshot so the UI can
 * say "not reported" rather than render a plausible-looking number.
 *
 * Two things are NOT available from this endpoint and are never faked:
 *   - per-room metrics. LiveKit labels these series with `node_id`, not room
 *     name, so room-level CPU or bitrate has to come from elsewhere or not at
 *     all.
 *   - host-level CPU/RAM/disk for the machine running LiveKit. `process_*`
 *     describes the server process itself, which is what is reported here.
 */

import { metricsUrl } from '@/lib/env'
import {
  first,
  histogramMean,
  parsePrometheus,
  select,
  sum,
  type Sample,
} from '@/lib/metrics/prometheus'

export interface MetricsSnapshot {
  /** Unix ms of collection. */
  at: number
  /** false when no metrics endpoint is configured or reachable. */
  available: boolean
  error?: string

  /** LiveKit's own counters. */
  rooms: {
    /**
     * Rooms the server currently holds, per `livekit_room_total`. This is a
     * gauge, not a cumulative counter, and the RoomService remains the
     * authoritative source for the room list.
     */
    total: number
    /** Mean lifetime of finished rooms, seconds. Null before any room ends. */
    avgDurationSeconds: number | null
  }
  participants: {
    /** Currently connected, per the server's gauge. */
    connected: number
    /**
     * Cumulative participants since start. Null: `livekit_participant_total`
     * is a gauge of current connections, not a counter, so the total would
     * have to be invented.
     */
    total: number | null
  }
  transports: {
    packetsOut: number
    packetsDropped: number
    /** Dropped / (dropped + out). Null when no packets have flowed. */
    packetLossRatio: number | null
  }
  quality: {
    /** Mean quality score, 0-1. Null until a participant has reported one. */
    scoreAvg: number | null
    scoreCount: number
  }
  webrtc: {
    /** Seconds of forward jitter. */
    jitterSeconds: number | null
    /** Milliseconds of forward latency. */
    latencyMsAvg: number | null
    /**
     * Null unless LiveKit exports latency buckets. It currently exports only
     * `_sum`/`_count`, so a quantile cannot be derived without guessing.
     */
    latencyMsP95: number | null
  }
  /** The livekit-server process, not the host. */
  process: {
    cpuSecondsTotal: number | null
    residentMemoryBytes: number | null
    virtualMemoryBytes: number | null
    openFds: number | null
    goroutines: number | null
    /** Go heap in use. */
    heapInuseBytes: number | null
    goMemSysBytes: number | null
    networkReceiveBytesTotal: number | null
    networkTransmitBytesTotal: number | null
    uptimeSeconds: number | null
  }
  webhooks: {
    dispatched: number
    failed: number
    /** Mean number of queued webhooks per dispatch. */
    queueLengthAvg: number | null
  }
  api: {
    /** Mean RoomService request latency, ms. */
    twirpLatencyMsAvg: number | null
  }
}

function emptySnapshot(at: number, error: string): MetricsSnapshot {
  return {
    at,
    available: false,
    error,
    rooms: { total: 0, avgDurationSeconds: null },
    participants: { connected: 0, total: null },
    transports: { packetsOut: 0, packetsDropped: 0, packetLossRatio: null },
    quality: { scoreAvg: null, scoreCount: 0 },
    webrtc: { jitterSeconds: null, latencyMsAvg: null, latencyMsP95: null },
    process: {
      cpuSecondsTotal: null,
      residentMemoryBytes: null,
      virtualMemoryBytes: null,
      openFds: null,
      goroutines: null,
      heapInuseBytes: null,
      goMemSysBytes: null,
      networkReceiveBytesTotal: null,
      networkTransmitBytesTotal: null,
      uptimeSeconds: null,
    },
    webhooks: { dispatched: 0, failed: 0, queueLengthAvg: null },
    api: { twirpLatencyMsAvg: null },
  }
}

/** Reduce raw samples into a snapshot. Exported for tests. */
export function toSnapshot(samples: Sample[], at: number): MetricsSnapshot {
  const byType = (name: string, type: string) =>
    samples.filter((s) => s.name === name && s.labels.type === type)

  const packetsOut = sum(byType('livekit_node_packet_total', 'out'), 'livekit_node_packet_total')
  const packetsDropped = sum(
    byType('livekit_node_packet_total', 'dropped'),
    'livekit_node_packet_total',
  )
  const packetTotal = packetsOut + packetsDropped

  const startTime = first(samples, 'process_start_time_seconds')
  const forwardLatencyNs = histogramMean(samples, 'livekit_forward_latency_ns')

  return {
    at,
    available: true,
    rooms: {
      total: sum(samples, 'livekit_room_total'),
      avgDurationSeconds: histogramMean(samples, 'livekit_room_duration_seconds'),
    },
    participants: {
      connected: sum(samples, 'livekit_participant_total'),
      // Not derivable: the server exposes a current-connections gauge only.
      total: null,
    },
    transports: {
      packetsOut,
      packetsDropped,
      packetLossRatio: packetTotal > 0 ? packetsDropped / packetTotal : null,
    },
    quality: {
      scoreAvg: histogramMean(samples, 'livekit_quality_score'),
      scoreCount: sum(samples, 'livekit_quality_score_count'),
    },
    webrtc: {
      jitterSeconds: first(samples, 'livekit_forward_jitter'),
      // `livekit_forward_latency_ns` is a real media-forwarding latency
      // histogram in nanoseconds. The Twirp histogram measures control-plane
      // API calls and stays under `api`, where it cannot be mistaken for RTT.
      latencyMsAvg: forwardLatencyNs === null ? null : forwardLatencyNs / 1e6,
      // LiveKit exports no latency buckets, only `_sum`/`_count`.
      latencyMsP95: null,
    },
    process: {
      cpuSecondsTotal: first(samples, 'process_cpu_seconds_total'),
      residentMemoryBytes: first(samples, 'process_resident_memory_bytes'),
      virtualMemoryBytes: first(samples, 'process_virtual_memory_bytes'),
      openFds: first(samples, 'process_open_fds'),
      goroutines: first(samples, 'go_goroutines'),
      heapInuseBytes: first(samples, 'go_memstats_heap_inuse_bytes'),
      goMemSysBytes: first(samples, 'go_memstats_sys_bytes'),
      networkReceiveBytesTotal: first(samples, 'process_network_receive_bytes_total'),
      networkTransmitBytesTotal: first(samples, 'process_network_transmit_bytes_total'),
      uptimeSeconds: startTime === null ? null : Math.max(0, at / 1000 - startTime),
    },
    webhooks: {
      dispatched: sum(
        select(samples, 'livekit_webhook_dispatch_total').filter(
          (s) => s.labels.status === 'success',
        ),
        'livekit_webhook_dispatch_total',
      ),
      failed: sum(
        select(samples, 'livekit_webhook_dispatch_total').filter(
          (s) => s.labels.status === 'failure',
        ),
        'livekit_webhook_dispatch_total',
      ),
      queueLengthAvg: histogramMean(samples, 'livekit_webhook_queue_length'),
    },
    api: {
      twirpLatencyMsAvg: histogramMean(samples, 'livekit_node_twirp_request_latency_ms'),
    },
  }
}

const FETCH_TIMEOUT_MS = 5_000
/** Long enough to collapse concurrent scrapes, short enough to stay live. */
const CACHE_TTL_MS = 2_000

type Cache = { snapshot: MetricsSnapshot; expiresAt: number }
const globalForCache = globalThis as unknown as { __lkdMetricsCache?: Cache }

/**
 * Fetch and reduce the metrics endpoint. Never throws.
 *
 * Concurrent callers share one scrape: `/api/monitoring` is polled by every open
 * tab, and the Prometheus endpoint is a single local server that would otherwise
 * see one request per tab per interval.
 */
export async function collectMetrics(): Promise<MetricsSnapshot> {
  const cached = globalForCache.__lkdMetricsCache
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot

  const snapshot = await scrape()
  // Failures are cached too, so an unreachable endpoint cannot turn into a
  // retry storm against something that is already down.
  globalForCache.__lkdMetricsCache = { snapshot, expiresAt: Date.now() + CACHE_TTL_MS }
  return snapshot
}

async function scrape(): Promise<MetricsSnapshot> {
  const at = Date.now()

  const url = metricsUrl()
  if (!url) {
    return emptySnapshot(at, 'No metrics endpoint configured. Set LIVEKIT_METRICS_URL.')
  }

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      return emptySnapshot(at, `Metrics endpoint returned HTTP ${res.status}`)
    }
    const samples = parsePrometheus(await res.text())
    return toSnapshot(samples, at)
  } catch (error) {
    return emptySnapshot(
      at,
      error instanceof Error ? error.message : 'Failed to reach the metrics endpoint',
    )
  }
}
