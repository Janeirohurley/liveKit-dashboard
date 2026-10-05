/**
 * Display formatting for measured values.
 *
 * Kept separate from `lib/utils` because these take nullable input: a metric the
 * server does not export formats as "n/a", not as "0 B". That distinction is
 * the whole reason this file exists.
 */

export function formatBytesShort(bytes: number): string {
  if (!Number.isFinite(bytes)) return 'n/a'
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`
  return `${Math.round(bytes)} B`
}

/** Bitrate in bits per second, as Prometheus counters report it. */
export function formatBitrate(bitsPerSecond: number): string {
  if (!Number.isFinite(bitsPerSecond)) return 'n/a'
  if (bitsPerSecond >= 1_000_000_000) return `${(bitsPerSecond / 1_000_000_000).toFixed(2)} Gbps`
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
  if (bitsPerSecond >= 1_000) return `${(bitsPerSecond / 1_000).toFixed(1)} kbps`
  return `${Math.round(bitsPerSecond)} bps`
}

/** A nullable number with an explicit unit. */
export function formatMetric(
  value: number | null | undefined,
  unit: string,
  digits = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(digits)} ${unit}`
}

/** A nullable percentage, already expressed 0-1. */
export function formatRatio(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a'
  return `${(value * 100).toFixed(digits)}%`
}

export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return 'n/a'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${Math.floor(seconds % 60)}s`
}
