import { describe, expect, it } from 'vitest'
import {
  first,
  histogramMean,
  histogramQuantile,
  parsePrometheus,
  select,
  sum,
} from '@/lib/metrics/prometheus'
import { toSnapshot } from '@/lib/metrics/collect'

const SAMPLE = `
# HELP livekit_room_total Total number of rooms
# TYPE livekit_room_total gauge
livekit_room_total{node_id="ND_1",node_type="SERVER"} 3
livekit_room_total{node_id="ND_2",node_type="SERVER"} 2
livekit_participant_total{node_id="ND_1",node_type="SERVER"} 4
livekit_participant_total{node_id="ND_2",node_type="SERVER"} 6
livekit_room_duration_seconds_sum{node_id="ND_1",node_type="SERVER"} 400
livekit_room_duration_seconds_count{node_id="ND_1",node_type="SERVER"} 4
livekit_node_packet_total{node_id="ND_1",node_type="SERVER",type="out"} 900
livekit_node_packet_total{node_id="ND_2",node_type="SERVER",type="out"} 100
livekit_node_packet_total{node_id="ND_1",node_type="SERVER",type="dropped"} 10
livekit_forward_jitter{node_id="ND_1",node_type="SERVER"} 0.0025
livekit_forward_latency_ns_sum{node_id="ND_1",node_type="SERVER"} 4000000
livekit_forward_latency_ns_count{node_id="ND_1",node_type="SERVER"} 4
livekit_quality_score_sum{node_id="ND_1",node_type="SERVER"} 3.6
livekit_quality_score_count{node_id="ND_1",node_type="SERVER"} 4
livekit_webhook_dispatch_total{node_id="ND_1",node_type="SERVER",reason="",status="success"} 9
livekit_webhook_dispatch_total{node_id="ND_1",node_type="SERVER",reason="",status="failure"} 1
livekit_node_twirp_request_latency_ms_sum{method="ListRooms",node_id="ND_1",node_type="SERVER",service="RoomService",status="200"} 40
livekit_node_twirp_request_latency_ms_count{method="ListRooms",node_id="ND_1",node_type="SERVER",service="RoomService",status="200"} 10
process_cpu_seconds_total 12.5
process_resident_memory_bytes 104857600
process_start_time_seconds 1700000000
`

describe('parsePrometheus', () => {
  it('reads labels, including values containing spaces', () => {
    const samples = parsePrometheus(
      'livekit_room_duration_seconds{node_id="a",reason="room timeout"} 1.5\n',
    )
    expect(samples).toHaveLength(1)
    expect(samples[0].name).toBe('livekit_room_duration_seconds')
    expect(samples[0].labels).toEqual({ node_id: 'a', reason: 'room timeout' })
    expect(samples[0].value).toBe(1.5)
  })

  it('reads unlabelled series', () => {
    const [sample] = parsePrometheus('process_resident_memory_bytes 104857600\n')
    expect(sample).toEqual({ name: 'process_resident_memory_bytes', labels: {}, value: 104857600 })
  })

  it('skips comments, blank lines, and unparseable values', () => {
    const samples = parsePrometheus(
      '# HELP x help\n# TYPE x gauge\n\nbroken_metric no_value_not_a_number\nlivekit_room_total 1\n',
    )
    expect(samples.map((s) => s.name)).toEqual(['livekit_room_total'])
  })

  it('keeps a +Inf bucket bound in the label and the count as the value', () => {
    const [sample] = parsePrometheus('x_bucket{le="+Inf"} 10\n')
    expect(sample.labels.le).toBe('+Inf')
    expect(sample.value).toBe(10)
  })

  it('keeps every series, so callers can sum what they need', () => {
    expect(parsePrometheus(SAMPLE).length).toBeGreaterThan(20)
  })
})

describe('aggregates', () => {
  const samples = parsePrometheus(SAMPLE)

  it('sums across label sets', () => {
    expect(sum(samples, 'livekit_room_total')).toBe(5)
  })

  it('select returns only the named metric', () => {
    expect(select(samples, 'livekit_participant_total')).toHaveLength(2)
  })

  it('first returns the first value, or null when absent', () => {
    expect(first(samples, 'process_resident_memory_bytes')).toBe(104857600)
    expect(first(samples, 'does_not_exist')).toBeNull()
  })

  it('histogramMean is sum over count', () => {
    expect(histogramMean(samples, 'livekit_room_duration_seconds')).toBe(100)
  })

  it('histogramMean is null when nothing was observed', () => {
    expect(histogramMean(samples, 'never_recorded')).toBeNull()
  })
})

describe('histogramQuantile', () => {
  const buckets = `
x_bucket{le="1"} 1
x_bucket{le="2"} 3
x_bucket{le="5"} 10
x_bucket{le="+Inf"} 10
`

  it('returns the first bucket reaching the quantile', () => {
    const samples = parsePrometheus(buckets)
    // target = q * total(10): 3 -> le=2, 5 -> le=5, 9 -> le=5
    expect(histogramQuantile(samples, 'x', 0.3)).toBe(2)
    expect(histogramQuantile(samples, 'x', 0.5)).toBe(5)
    expect(histogramQuantile(samples, 'x', 0.9)).toBe(5)
  })

  it('returns null when no observations exist', () => {
    expect(histogramQuantile(parsePrometheus('x_bucket{le="+Inf"} 0\n'), 'x', 0.95)).toBeNull()
  })

  it('does not return the +Inf bound', () => {
    const samples = parsePrometheus('x_bucket{le="1"} 1\nx_bucket{le="+Inf"} 100\n')
    expect(histogramQuantile(samples, 'x', 0.95)).toBeNull()
  })
})

describe('toSnapshot', () => {
  const snapshot = toSnapshot(parsePrometheus(SAMPLE), 1_800_000_000_000)

  it('sums gauges across nodes', () => {
    expect(snapshot.available).toBe(true)
    expect(snapshot.rooms.total).toBe(5)
    expect(snapshot.participants.connected).toBe(10)
  })

  it('leaves the cumulative participant total null instead of reusing the gauge', () => {
    expect(snapshot.participants.total).toBeNull()
  })

  it('computes packet loss from out and dropped counters', () => {
    expect(snapshot.transports.packetsOut).toBe(1000)
    expect(snapshot.transports.packetsDropped).toBe(10)
    expect(snapshot.transports.packetLossRatio).toBeCloseTo(10 / 1010, 6)
  })

  it('derives WebRTC latency from the forwarding histogram, in milliseconds', () => {
    expect(snapshot.webrtc.latencyMsAvg).toBe(1)
    expect(snapshot.webrtc.jitterSeconds).toBe(0.0025)
  })

  it('leaves the latency quantile null, since no buckets are exported', () => {
    expect(snapshot.webrtc.latencyMsP95).toBeNull()
  })

  it('keeps control-plane latency separate from media latency', () => {
    expect(snapshot.api.twirpLatencyMsAvg).toBe(4)
    expect(snapshot.webrtc.latencyMsAvg).not.toBe(snapshot.api.twirpLatencyMsAvg)
  })

  it('reads webhook dispatch outcomes by status label', () => {
    expect(snapshot.webhooks.dispatched).toBe(9)
    expect(snapshot.webhooks.failed).toBe(1)
  })

  it('computes uptime from the process start time', () => {
    expect(snapshot.process.uptimeSeconds).toBe(1_800_000_000 - 1_700_000_000)
  })

  it('reports null for metrics the server does not export', () => {
    expect(snapshot.process.goroutines).toBeNull()
    expect(snapshot.process.heapInuseBytes).toBeNull()
    expect(snapshot.quality.scoreAvg).toBeCloseTo(0.9, 6)
  })
})
