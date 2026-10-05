/**
 * Prometheus text-format parser.
 *
 * Deliberately minimal: it handles the exposition format the Go client emits
 * (no exemplars, no native histograms), which is all `/metrics` on a
 * livekit-server produces. Written by hand rather than pulled in as a
 * dependency because the subset is small and the alternative is shipping a
 * general-purpose client to read one endpoint.
 *
 * Returns the raw sample list rather than an aggregated view, so each caller
 * can sum the series it cares about and keep every label that matters. Room
 * names are NOT labels on these metrics — LiveKit reports `node_id`,
 * `node_type`, `room_` prefixed counters without a room label — so per-room
 * metrics are not available here and are never invented.
 */

export interface Sample {
  name: string
  labels: Record<string, string>
  value: number
}

function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {}
  // Values may contain spaces and escaped quotes, so track quote state rather
  // than splitting on whitespace.
  let i = 0
  while (i < raw.length) {
    while (i < raw.length && (raw[i] === ' ' || raw[i] === ',')) i++
    const eq = raw.indexOf('=', i)
    if (eq === -1) break
    const key = raw.slice(i, eq).trim()
    i = eq + 1
    while (i < raw.length && raw[i] === ' ') i++
    if (raw[i] !== '"') break
    i++
    let value = ''
    while (i < raw.length) {
      if (raw[i] === '\\' && i + 1 < raw.length) {
        value += raw[i + 1]
        i += 2
        continue
      }
      if (raw[i] === '"') {
        i++
        break
      }
      value += raw[i]
      i++
    }
    if (key) labels[key] = value
  }
  return labels
}

/**
 * Numeric value, tolerating the spellings Prometheus allows for the infinities.
 * `+Inf` is the standard bucket bound and `Number("+Inf")` is NaN, so the
 * infinities have to be handled before falling back to `Number`.
 */
function parseValue(raw: string): number | null {
  const lower = raw.trim().toLowerCase()
  if (lower === '+inf' || lower === 'inf') return Infinity
  if (lower === '-inf') return -Infinity
  if (lower === 'nan') return NaN
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function parsePrometheus(text: string): Sample[] {
  const samples: Sample[] = []
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const brace = line.indexOf('{')
    const lastSpace = line.lastIndexOf(' ')
    if (lastSpace === -1) continue

    if (brace !== -1 && brace < lastSpace) {
      const name = line.slice(0, brace).trim()
      const labelEnd = line.lastIndexOf('}', lastSpace)
      if (labelEnd === -1) continue
      const labels = parseLabels(line.slice(brace + 1, labelEnd))
      const value = parseValue(line.slice(lastSpace + 1))
      if (value === null) continue
      samples.push({ name, labels, value })
    } else {
      const name = line.slice(0, lastSpace).trim()
      const value = parseValue(line.slice(lastSpace + 1))
      if (value === null) continue
      samples.push({ name, labels: {}, value })
    }
  }
  return samples
}

/** All samples for one metric name. */
export function select(samples: Sample[], name: string): Sample[] {
  return samples.filter((s) => s.name === name)
}

/** Sum of every series for a metric name. */
export function sum(samples: Sample[], name: string): number {
  let total = 0
  for (const s of samples) {
    if (s.name === name) total += s.value
  }
  return total
}

/**
 * First value for a metric name, or null.
 *
 * Use for metrics a server reports once per node (heap, open fds) where a sum
 * across series would be meaningless.
 */
export function first(samples: Sample[], name: string): number | null {
  for (const s of samples) {
    if (s.name === name) return s.value
  }
  return null
}

/**
 * Sum histogram buckets into an average.
 *
 * `sum / count` is the mean across all observations, which is what an operator
 * reads a latency histogram for. Returns null rather than 0 when the histogram
 * has no observations, so "no data" stays distinguishable from "instant".
 */
export function histogramMean(
  samples: Sample[],
  base: string,
  labels?: (labelSet: Record<string, string>) => boolean,
): number | null {
  let sumValue = 0
  let count = 0
  for (const s of samples) {
    if (labels && !labels(s.labels)) continue
    if (s.name === `${base}_sum`) sumValue += s.value
    else if (s.name === `${base}_count`) count += s.value
  }
  if (count <= 0) return null
  return sumValue / count
}

/**
 * Quantile approximated from cumulative buckets.
 *
 * Prometheus histograms carry no interpolation here, so this is a bucket
 * lookup, not an estimate: it returns the `le` of the first bucket whose
 * cumulative count reaches the quantile. Coarse, and honest about it.
 */
export function histogramQuantile(
  samples: Sample[],
  base: string,
  q: number,
  labels?: (labelSet: Record<string, string>) => boolean,
): number | null {
  const buckets = new Map<number, number>()
  for (const s of samples) {
    if (labels && !labels(s.labels)) continue
    if (!s.name.startsWith(`${base}_bucket`)) continue
    // `Number("+Inf")` is NaN, so the bound needs the same tolerance as values.
    const le = parseValue(s.labels.le)
    if (le === null || Number.isNaN(le)) continue
    buckets.set(le, (buckets.get(le) ?? 0) + s.value)
  }
  // The `+Inf` bucket is the observation count for a cumulative histogram, but
  // fall back to the largest finite bucket so a truncated exposition still
  // yields a quantile instead of a silent null.
  const total = buckets.get(Number.POSITIVE_INFINITY) ?? Math.max(0, ...buckets.values())
  if (total <= 0) return null

  const target = q * total
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  for (const [le, cumulative] of sorted) {
    if (cumulative >= target) {
      return le === Number.POSITIVE_INFINITY ? null : le
    }
  }
  return null
}
