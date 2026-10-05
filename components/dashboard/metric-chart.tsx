"use client"

import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { cn } from "@/lib/utils"

/**
 * Chart over measured samples.
 *
 * `data` is supplied by the caller — there is no internal timer and no
 * generator. A chart that invents its own points is worse than no chart: it
 * looks alive while telling you nothing. With real data the series moves when
 * the system moves, and an empty array renders an explicit empty state rather
 * than a flat line that reads as "steady at zero".
 */

export interface ChartSeries {
  /** Data key, and the config key below. */
  key: string
  label: string
  color?: string
  /** Format for the tooltip and the Y axis tick. */
  format?: (value: number) => string
  /** Per-series Y axis domain. Omit to let recharts scale. */
  domain?: [number | "auto", number | "auto"]
}

export interface ChartPoint {
  /** ISO timestamp, used as the X axis key. */
  at: string
  [field: string]: string | number | null
}

export function MetricChart({
  title,
  description,
  type = "area",
  series,
  data,
  className,
  height = 220,
  emptyLabel = "No samples yet",
}: {
  title?: string
  description?: string
  type?: "area" | "line"
  series: ChartSeries[]
  data: ChartPoint[]
  className?: string
  height?: number
  emptyLabel?: string
}) {
  const config = useMemo<ChartConfig>(() => {
    const out: ChartConfig = {}
    series.forEach((s, i) => {
      out[s.key] = {
        label: s.label,
        color: s.color ?? `var(--chart-${(i % 5) + 1})`,
      }
    })
    return out
  }, [series])

  const gradId = useMemo(
    () => `grad-${series.map((s) => s.key).join("-") || "empty"}`,
    [series],
  )

  const hasData = data.length > 0

  const formatTick = (v: number) => {
    const spec = series[0]?.format
    return spec ? spec(v) : String(v)
  }

  const labelFor = (point: ChartPoint) => {
    const d = new Date(point.at)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }

  return (
    <div className={cn("rounded-2xl bg-card ring-1 ring-border p-5", className)}>
      {(title || description) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold tracking-tight">{title}</h3>}
            {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          </div>
          {hasData && (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-success bg-success/10 ring-1 ring-success/20 px-2 py-0.5 rounded-full">
              <span className="size-1.5 rounded-full bg-success animate-pulse-dot" />
              LIVE
            </span>
          )}
        </div>
      )}

      {!hasData ? (
        <div
          className="flex items-center justify-center text-xs text-muted-foreground"
          style={{ height }}
        >
          {emptyLabel}
        </div>
      ) : (
        <ChartContainer config={config} className="!aspect-auto w-full" style={{ height }}>
          {type === "area" ? (
            <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                {series.map((s, i) => (
                  <linearGradient key={s.key} id={`${gradId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor={s.color ?? `var(--chart-${(i % 5) + 1})`}
                      stopOpacity={0.5}
                    />
                    <stop
                      offset="100%"
                      stopColor={s.color ?? `var(--chart-${(i % 5) + 1})`}
                      stopOpacity={0}
                    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="at"
                tickFormatter={labelFor}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={formatTick}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                width={48}
                domain={series[0]?.domain}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => {
                      const spec = series.find((s) => s.key === name)
                      const n = typeof value === "number" ? value : Number(value)
                      return [spec?.format && Number.isFinite(n) ? spec.format(n) : String(value), spec?.label ?? String(name)]
                    }}
                  />
                }
                labelFormatter={(label) => new Date(String(label)).toLocaleString()}
              />
              {/* connectNulls is deliberately off: a null point marks a sample the
                  metrics endpoint never produced, and joining across it would
                  draw a value that was never measured. */}
              {series.map((s, i) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  connectNulls={false}
                  stroke={s.color ?? `var(--chart-${(i % 5) + 1})`}
                  strokeWidth={2}
                  fill={`url(#${gradId}-${s.key})`}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="at"
                tickFormatter={labelFor}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={formatTick}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                width={48}
                domain={series[0]?.domain}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => {
                      const spec = series.find((s) => s.key === name)
                      const n = typeof value === "number" ? value : Number(value)
                      return [
                        spec?.format && Number.isFinite(n) ? spec.format(n) : String(value),
                        spec?.label ?? String(name),
                      ]
                    }}
                  />
                }
                labelFormatter={(label) => new Date(String(label)).toLocaleString()}
              />
              {series.map((s, i) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  connectNulls={false}
                  stroke={s.color ?? `var(--chart-${(i % 5) + 1})`}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          )}
        </ChartContainer>
      )}
    </div>
  )
}
