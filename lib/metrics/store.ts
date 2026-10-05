/**
 * Time-series store for metrics snapshots.
 *
 * The charts need history: a gauge scraped every few seconds is only a number
 * until you have the last N of them. Prometheus keeps its own history, but
 * querying it would mean shipping a PromQL client and depending on retention
 * settings the dashboard does not control — so the dashboard keeps a bounded
 * roll of its own.
 *
 * Retention is enforced on write rather than by a cron job, because there is no
 * scheduler in this app and a table that only grows is a table that eventually
 * takes the database down.
 */

import { getDb } from '@/lib/db'
import type { MetricsSnapshot } from '@/lib/metrics/collect'

/** Roughly a day at the default cadence. */
export const SNAPSHOT_RETENTION_HOURS = 24

/**
 * Minimum spacing between stored snapshots.
 *
 * 30s: the UI polls every 5s, so a tighter guard would store six rows for every
 * one the chart can show. 2880 rows/day is a day of history at a resolution fine
 * enough to see a deployment degrade.
 */
export const SNAPSHOT_MIN_INTERVAL_SECONDS = 30
export const SNAPSHOT_MIN_INTERVAL_MS = SNAPSHOT_MIN_INTERVAL_SECONDS * 1000

export interface SnapshotPoint {
  at: string
  rooms: number | null
  participants: number | null
  packetsOut: number | null
  packetsDropped: number | null
  packetLossRatio: number | null
  qualityScore: number | null
  latencyMs: number | null
  cpuSecondsTotal: number | null
  /**
   * CPU time consumed between the previous snapshot and this one, as a
   * percentage of one core. Derived from stored counters, so it survives a
   * dashboard restart — unlike an in-memory delta, which is null for the first
   * sample after every restart.
   */
  cpuPercent: number | null
  residentMemoryBytes: number | null
  webhooksFailed: number | null
}

interface SnapshotRow {
  recorded_at: Date
  available: boolean
  rooms_total: number | null
  participants_connected: number | null
  participants_total: number | null
  packets_out: string | number | null
  packets_dropped: string | number | null
  packet_loss_ratio: number | null
  quality_score_avg: number | null
  latency_ms_avg: number | null
  cpu_seconds_total: number | null
  resident_memory_bytes: string | number | null
  webhooks_failed: string | number | null
}

const num = (v: string | number | null): number | null => {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * A point for a sample where the metrics endpoint was unreachable.
 *
 * The timestamp is real, every value is null. Charts see a break in the line
 * instead of interpolating across the outage.
 */
function blankPoint(recordedAt: Date | string): SnapshotPoint {
  return {
    at: new Date(recordedAt).toISOString(),
    rooms: null,
    participants: null,
    packetsOut: null,
    packetsDropped: null,
    packetLossRatio: null,
    qualityScore: null,
    latencyMs: null,
    cpuSecondsTotal: null,
    cpuPercent: null,
    residentMemoryBytes: null,
    webhooksFailed: null,
  }
}

/**
 * CPU time is a monotonic counter, so a percentage only exists between two
 * samples. `previous` is the sample immediately before this one; the oldest
 * point in the window gets null because there is nothing to subtract from.
 */
function toPoint(row: SnapshotRow, previous?: SnapshotRow): SnapshotPoint {
  const at = new Date(row.recorded_at).getTime()
  const cpuSecondsTotal = num(row.cpu_seconds_total)
  const prevCpu = previous ? num(previous.cpu_seconds_total) : null
  let cpuPercent: number | null = null
  // A previous sample that was unavailable has no usable counter baseline, so
  // the first sample after an outage has no percentage either.
  if (previous?.available && cpuSecondsTotal !== null && prevCpu !== null) {
    const elapsedWall = (at - new Date(previous.recorded_at).getTime()) / 1000
    const elapsedCpu = cpuSecondsTotal - prevCpu
    if (elapsedWall > 0 && elapsedCpu >= 0) {
      // One core is 100%; more than that is legitimate, so no clamping.
      cpuPercent = (elapsedCpu / elapsedWall) * 100
    }
  }

  return {
    at: new Date(row.recorded_at).toISOString(),
    rooms: row.rooms_total,
    participants: row.participants_connected,
    packetsOut: num(row.packets_out),
    packetsDropped: num(row.packets_dropped),
    packetLossRatio: row.packet_loss_ratio,
    qualityScore: row.quality_score_avg,
    latencyMs: row.latency_ms_avg,
    cpuSecondsTotal,
    cpuPercent,
    residentMemoryBytes: num(row.resident_memory_bytes),
    webhooksFailed: num(row.webhooks_failed),
  }
}

/**
 * Append a snapshot, unless one was stored very recently.
 *
 * The interval guard exists so several readers of `/api/monitoring` cannot
 * each write a row and turn a 5s UI poll into a 5s database write storm. When
 * the endpoint is down the row is still written, flagged unavailable, because
 * a gap in the chart is more informative than a straight line through it.
 */
export async function recordSnapshot(snapshot: MetricsSnapshot): Promise<boolean> {
  try {
    const sql = await getDb()
    const inserted = await sql<{ id: string }[]>`
with recent as (
         select id from dashboard_metrics_snapshots
          where recorded_at > now() - ${`${SNAPSHOT_MIN_INTERVAL_SECONDS} seconds`}::interval
          limit 1
       )
      insert into dashboard_metrics_snapshots
        (available, rooms_total, rooms_avg_duration_s, participants_connected,
         participants_total, packets_out, packets_dropped, packet_loss_ratio,
         quality_score_avg, quality_score_count, jitter_seconds, latency_ms_avg,
         cpu_seconds_total, resident_memory_bytes, heap_inuse_bytes, open_fds,
         goroutines, network_rx_bytes, network_tx_bytes, webhooks_dispatched,
         webhooks_failed)
      select
        ${snapshot.available}, ${snapshot.rooms.total},
        ${snapshot.rooms.avgDurationSeconds}, ${snapshot.participants.connected},
        ${snapshot.participants.total}, ${snapshot.transports.packetsOut},
        ${snapshot.transports.packetsDropped}, ${snapshot.transports.packetLossRatio},
        ${snapshot.quality.scoreAvg}, ${snapshot.quality.scoreCount},
        ${snapshot.webrtc.jitterSeconds}, ${snapshot.webrtc.latencyMsAvg},
        ${snapshot.process.cpuSecondsTotal}, ${snapshot.process.residentMemoryBytes},
        ${snapshot.process.heapInuseBytes}, ${snapshot.process.openFds},
        ${snapshot.process.goroutines}, ${snapshot.process.networkReceiveBytesTotal},
        ${snapshot.process.networkTransmitBytesTotal}, ${snapshot.webhooks.dispatched},
        ${snapshot.webhooks.failed}
      where not exists (select 1 from recent)
      returning id
    `
    if (inserted.length === 0) return false

    // Trim on write. Only runs on the insert path, so it cannot fire in a loop.
    await sql`
      delete from dashboard_metrics_snapshots
       where recorded_at < now() - ${`${SNAPSHOT_RETENTION_HOURS} hours`}::interval
    `
    return true
  } catch (error) {
    console.error(
      '[metrics] snapshot write failed -',
      error instanceof Error ? error.message : error,
    )
    return false
  }
}

const SELECT_COLUMNS = `
  recorded_at, available, rooms_total, participants_connected,
  participants_total, packets_out, packets_dropped, packet_loss_ratio,
  quality_score_avg, latency_ms_avg, cpu_seconds_total,
  resident_memory_bytes, webhooks_failed`

/**
 * Oldest-to-newest history for the charts.
 *
 * Rows are fetched newest-first so the SQL `limit` keeps the most recent window,
 * then reversed for charting. CPU percentages need the sample before each row,
 * so one extra row is fetched past the limit to give the oldest visible point a
 * baseline instead of leaving it null.
 *
 * Unavailable rows are kept and mapped to all-null points. Filtering them out
 * would leave the good samples either side adjacent in the array, and the chart
 * would draw a straight line across the outage — the exact "invented continuity"
 * this store exists to avoid. A null point makes the line break.
 */
export async function listSnapshots(
  limit = 240,
  sinceMinutes?: number,
): Promise<SnapshotPoint[]> {
  const sql = await getDb()
  const capped = Math.min(Math.max(limit, 1), 2000)
  const rows = sinceMinutes
    ? await sql<SnapshotRow[]>`
        select ${sql.unsafe(SELECT_COLUMNS)}
          from dashboard_metrics_snapshots
         where recorded_at > now() - ${`${sinceMinutes} minutes`}::interval
         order by recorded_at desc
         limit ${capped + 1}
      `
    : await sql<SnapshotRow[]>`
        select ${sql.unsafe(SELECT_COLUMNS)}
          from dashboard_metrics_snapshots
         order by recorded_at desc
         limit ${capped + 1}
      `

  const ascending = [...rows].reverse()
  const points = ascending.map((row, i) => {
    if (!row.available) return blankPoint(row.recorded_at)
    return toPoint(row, i > 0 ? ascending[i - 1] : undefined)
  })
  // The oldest row in the window exists only to seed the first CPU delta.
  return points.slice(-capped)
}
