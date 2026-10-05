import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listSnapshots, recordSnapshot, SNAPSHOT_RETENTION_HOURS } from '@/lib/metrics/store'
import type { MetricsSnapshot } from '@/lib/metrics/collect'

/**
 * Runs against the developer's Postgres, like the webhook store tests. Skipped
 * without DATABASE_URL so a contributor without a database still gets a green
 * suite.
 */
const hasDb = Boolean(process.env.DATABASE_URL)

function snapshot(overrides: Partial<MetricsSnapshot> = {}): MetricsSnapshot {
  return {
    at: Date.now(),
    available: true,
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
    ...overrides,
  }
}

describe.skipIf(!hasDb)('metrics store', () => {
  let sql: Awaited<ReturnType<typeof import('@/lib/db').getDb>>

  beforeAll(async () => {
    const { getDb } = await import('@/lib/db')
    sql = await getDb()
    await sql`delete from dashboard_metrics_snapshots`
  })

  afterAll(async () => {
    await sql`delete from dashboard_metrics_snapshots`
    await sql.end({ timeout: 5 })
  })

  it('rate-limits writes so a 5s poll cannot become a 5s write', async () => {
    const first = await recordSnapshot(snapshot())
    expect(first).toBe(true)
    // Same second: the guard must reject it.
    expect(await recordSnapshot(snapshot())).toBe(false)
  })

  it('derives CPU percent from stored counters, not an in-memory delta', async () => {
    // Wipe and write two spaced samples: 3 CPU-seconds over 10 wall-seconds.
    await sql`delete from dashboard_metrics_snapshots`
    await sql`
      insert into dashboard_metrics_snapshots (recorded_at, available, cpu_seconds_total)
      values (now() - interval '10 seconds', true, 10),
             (now(), true, 13)
    `
    const points = await listSnapshots(10)
    expect(points).toHaveLength(2)
    // Oldest point has no baseline inside the window, newest does.
    expect(points[0].cpuPercent).toBeNull()
    expect(points[1].cpuPercent).toBeCloseTo(30, 0)
  })

  it('returns points oldest-first', async () => {
    await sql`delete from dashboard_metrics_snapshots`
    await sql`
      insert into dashboard_metrics_snapshots (recorded_at, available, rooms_total)
      values (now() - interval '3 seconds', true, 1),
             (now() - interval '2 seconds', true, 2),
             (now() - interval '1 second', true, 3)
    `
    const points = await listSnapshots(10)
    expect(points.map((p) => p.rooms)).toEqual([1, 2, 3])
  })

  it('returns a null point for an unavailable sample so the line breaks', async () => {
    // Filtering the row out instead would leave the two good samples adjacent,
    // and the chart would draw a straight line across the outage.
    await sql`delete from dashboard_metrics_snapshots`
    await sql`
      insert into dashboard_metrics_snapshots (recorded_at, available, rooms_total)
      values (now() - interval '2 seconds', true, 5),
             (now() - interval '1 second', false, 99)
    `
    const points = await listSnapshots(10)
    expect(points.map((p) => p.rooms)).toEqual([5, null])
    // The unavailable row's real value must not leak into the history.
    expect(points[1].packetsOut).toBeNull()
    expect(points[1].cpuPercent).toBeNull()
  })

  it('leaves the first sample after an outage without a CPU percentage', async () => {
    await sql`delete from dashboard_metrics_snapshots`
    await sql`
      insert into dashboard_metrics_snapshots (recorded_at, available, cpu_seconds_total)
      values (now() - interval '20 seconds', true, 10),
             (now() - interval '10 seconds', false, null),
             (now(), true, 13)
    `
    const points = await listSnapshots(10)
    expect(points.map((p) => p.cpuPercent)).toEqual([null, null, null])
  })

  it('prunes beyond the retention window', async () => {
    await sql`delete from dashboard_metrics_snapshots`
    await sql`
      insert into dashboard_metrics_snapshots (recorded_at, available, rooms_total)
      values (now() - ${`${SNAPSHOT_RETENTION_HOURS + 2} hours`}::interval, true, 7)
    `
    // The insert path runs the prune.
    expect(await recordSnapshot(snapshot())).toBe(true)
    const rows = await sql<{ rooms_total: number }[]>`
      select rooms_total from dashboard_metrics_snapshots
    `
    expect(rows.map((r) => r.rooms_total)).not.toContain(7)
  })
})
