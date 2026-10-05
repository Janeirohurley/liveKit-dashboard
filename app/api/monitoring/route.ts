import { NextRequest, NextResponse } from 'next/server'
import { EgressStatus } from 'livekit-server-sdk'
import { authenticate } from '@/lib/auth/session'
import { getLiveKitAdapter } from '@/lib/livekit/adapter'
import { collectMetrics } from '@/lib/metrics/collect'
import { listSnapshots, recordSnapshot } from '@/lib/metrics/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Protocol enum number → the name an operator recognises.
 *
 * Derived from the SDK enum rather than written out by hand: a literal table
 * silently mislabels every status if the protocol ever renumbers, and the UI
 * would report "complete" for a failed recording.
 */
const EGRESS_STATUS_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(EgressStatus)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => [v as number, k.replace(/^EGRESS_/, '').toLowerCase()]),
)


/**
 * Monitoring aggregates, built from measured values only.
 *
 * Room and participant counts come from the RoomService, which is the
 * authoritative source for "what exists right now". Everything under
 * `system` comes from the Prometheus endpoint and is null when that endpoint
 * is absent — the previous version of this route invented CPU/RAM/network
 * figures with Math.random(), and the UI then derived jitter, RTT and packet
 * loss from those invented numbers.
 *
 * `system.host` stays null even when the metrics endpoint is up: those series
 * describe the livekit-server process, not the machine under it. Reporting
 * host CPU would mean reaching outside this service.
 */
export async function GET(req: NextRequest) {
  const identity = await authenticate(req.headers)
  if (!identity) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const adapter = getLiveKitAdapter()
    const [rooms, egress, metrics] = await Promise.all([
      adapter.listRooms(),
      // Active only: listEgress() also returns completed jobs, and counting
      // those as "recordings running" inflated the number after every session.
      adapter.listActiveEgress().catch(() => []),
      collectMetrics(),
    ])

    // History write is best-effort and rate-limited inside recordSnapshot, so
    // several viewers cannot turn this into a write storm.
    await recordSnapshot(metrics)
    const history = await listSnapshots(240).catch(() => [])

    let totalParticipants = 0
    let totalPublishers = 0
    let totalMaxParticipants = 0
    const roomsFlaggedRecording = new Set<string>()

    const roomDetails = rooms.map((r) => {
      const participants = r.numParticipants ?? 0
      totalParticipants += participants
      totalPublishers += r.numPublishers ?? 0
      totalMaxParticipants += r.maxParticipants ?? 0
      if (r.activeRecording) roomsFlaggedRecording.add(r.name)

      return {
        name: r.name,
        sid: r.sid,
        participants,
        publishers: r.numPublishers ?? 0,
        maxParticipants: r.maxParticipants ?? 0,
        recording: Boolean(r.activeRecording),
        createdAt: r.creationTimeMs ? new Date(Number(r.creationTimeMs)).toISOString() : null,
        metadata: r.metadata ?? '',
      }
    })

    // A room carrying activeRecording is normally the same job the egress list
    // already reports. Counting both sources double-counted one recording, so
    // the number is the union: active egress jobs, plus flagged rooms that have
    // no matching egress entry yet.
    const egressSummaries = egress.map((e: any) => ({
      id: e.egressId ?? e.id ?? null,
      roomName: e.roomName ?? null,
      status: EGRESS_STATUS_NAMES[e.status as number] ?? null,
      startedAt: e.startedAt ? new Date(Number(e.startedAt) / 1_000_000).toISOString() : null,
    }))
    const matchedRooms = new Set(
      egressSummaries.map((e) => e.roomName).filter((n): n is string => Boolean(n)),
    )
    const recordingsActive = new Set<string>(matchedRooms)
    for (const name of roomsFlaggedRecording) recordingsActive.add(name)

    const avgParticipantsPerRoom = rooms.length > 0 ? totalParticipants / rooms.length : 0
    const capacityUtilization =
      totalMaxParticipants > 0 ? (totalParticipants / totalMaxParticipants) * 100 : null

    // CPU is derived in the store, from the delta between stored counters, so the
    // value survives a dashboard restart. Null on the first sample of a window.
    const cpuPercent = history.at(-1)?.cpuPercent ?? null

    return NextResponse.json({
      rooms: {
        total: rooms.length,
        active: rooms.filter((r) => (r.numParticipants ?? 0) > 0).length,
      },
      participants: {
        total: totalParticipants,
        publishers: totalPublishers,
        avgPerRoom: Math.round(avgParticipantsPerRoom * 10) / 10,
      },
      capacity: {
        max: totalMaxParticipants,
        utilization:
          capacityUtilization === null ? null : Math.round(capacityUtilization * 10) / 10,
      },
      recordings: {
        active: recordingsActive.size,
        egress: egressSummaries,
      },
      roomDetails,
      system: {
        available: metrics.available,
        error: metrics.error ?? null,
        cpuPercent,
        ramBytes: metrics.process.residentMemoryBytes,
        heapBytes: metrics.process.heapInuseBytes,
        goroutines: metrics.process.goroutines,
        openFds: metrics.process.openFds,
        uptimeSeconds: metrics.process.uptimeSeconds,
        networkRxBytes: metrics.process.networkReceiveBytesTotal,
        networkTxBytes: metrics.process.networkTransmitBytesTotal,
        // Not measurable from inside this service.
        host: null,
      },
      webrtc: {
        jitterSeconds: metrics.webrtc.jitterSeconds,
        latencyMsAvg: metrics.webrtc.latencyMsAvg,
        latencyMsP95: metrics.webrtc.latencyMsP95,
        packetLossRatio: metrics.transports.packetLossRatio,
        packetsOut: metrics.transports.packetsOut,
        packetsDropped: metrics.transports.packetsDropped,
      },
      // Server-side aggregate. `participants` here is the Prometheus gauge,
      // which counts node-local connections; the RoomService figures above are
      // the cluster-wide ones.
      metrics: {
        rooms: metrics.rooms,
        participants: metrics.participants,
        transports: metrics.transports,
        quality: metrics.quality,
        webrtc: metrics.webrtc,
        api: metrics.api,
      },
      webhooks: metrics.webhooks,
      history,
      collectedAt: new Date(metrics.at).toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
