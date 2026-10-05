"use client"

import Link from "next/link"
import { Cpu, MemoryStick, Activity, Users, Radio, Disc, Gauge } from "lucide-react"
import { StatsCard } from "@/components/dashboard/stats-card"
import { MetricChart, type ChartSeries } from "@/components/dashboard/metric-chart"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Progress } from "@/components/ui/progress"
import { useI18n } from "@/lib/i18n"
import { useMonitoring } from "@/hooks/useMonitoring"
import {
  formatBytesShort,
  formatMetric,
  formatRatio,
  formatUptime,
} from "@/lib/metrics/format"

/**
 * Every figure on this page comes from the Prometheus endpoint or the
 * RoomService. The version this replaced derived jitter, RTT and packet loss
 * from a fabricated network percentage, and reported host CPU/RAM it had no way
 * to measure. Where a source is missing the row shows "n/a" and the bar is
 * hidden, because a progress bar drawn from an invented number reads as a
 * measurement.
 */
export function MonitoringView() {
  const { t } = useI18n()
  const { data, loading, error, refresh } = useMonitoring()

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{t("monitoring.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("monitoring.subtitle")}</p>
        </div>
        <div className="h-32 flex items-center justify-center text-muted-foreground">
          Loading monitoring data...
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{t("monitoring.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("monitoring.subtitle")}</p>
        </div>
        <div className="rounded-2xl bg-destructive/10 ring-1 ring-destructive/20 p-6 text-destructive">
          <p className="font-medium">Error loading monitoring data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { system, webrtc, capacity, history } = data
  const metricsDown = !system.available

  const cpuSeries: ChartSeries[] = [
    {
      key: "cpuPercent",
      label: t("monitoring.cpu"),
      format: (v) => `${v.toFixed(0)}%`,
      domain: [0, "auto"],
    },
  ]
  const memorySeries: ChartSeries[] = [
    {
      key: "residentMemoryBytes",
      label: t("monitoring.ram"),
      format: formatBytesShort,
      domain: [0, "auto"],
    },
  ]
  const trafficSeries: ChartSeries[] = [
    {
      key: "packetsOut",
      label: "Packets out",
      format: (v) => v.toLocaleString(),
      domain: [0, "auto"],
    },
  ]
  const lossSeries: ChartSeries[] = [
    {
      key: "packetLossRatio",
      label: t("monitoring.packetLoss"),
      format: formatRatio,
      domain: [0, "auto"],
    },
  ]

  // Progress bars need a 0-100 value; anything not reported is skipped.
  const qualityBars = [
    {
      l: t("monitoring.packetLoss"),
      v: formatRatio(webrtc.packetLossRatio, 2),
      p:
        webrtc.packetLossRatio === null
          ? null
          : Math.min(100, webrtc.packetLossRatio * 100 * 20),
      hint: webrtc.packetLossRatio === null ? t("monitoring.notReported") : t("monitoring.hintDroppedTotal"),
    },
    {
      l: t("monitoring.jitter"),
      v: formatMetric(webrtc.jitterSeconds === null ? null : webrtc.jitterSeconds * 1000, "ms", 2),
      p: webrtc.jitterSeconds === null ? null : Math.min(100, webrtc.jitterSeconds * 1000 * 20),
      hint: webrtc.jitterSeconds === null ? t("monitoring.notReported") : t("monitoring.hintForwardJitter"),
    },
    {
      l: t("monitoring.rtt"),
      v: formatMetric(webrtc.latencyMsAvg, "ms", 2),
      p: webrtc.latencyMsAvg === null ? null : Math.min(100, webrtc.latencyMsAvg),
      hint: webrtc.latencyMsAvg === null ? t("monitoring.noMediaYet") : t("monitoring.hintMeanLatency"),
    },
    {
      l: t("monitoring.quality"),
      v: formatRatio(data.quality.scoreAvg, 2),
      p: data.quality.scoreAvg === null ? null : data.quality.scoreAvg * 100,
      hint: t("monitoring.hintSamples", { count: data.quality.scoreCount }),
    },
    {
      l: t("monitoring.capacity"),
      v: capacity.utilization === null ? "n/a" : `${capacity.utilization}%`,
      p: capacity.utilization === null ? null : capacity.utilization,
      hint: t("monitoring.hintMaxParticipants", { max: capacity.max }),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{t("monitoring.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("monitoring.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge variant={metricsDown ? "down" : "live"} pulse={!metricsDown}>
            {metricsDown ? "metrics down" : "live"}
          </StatusBadge>
          <span className="text-xs text-muted-foreground font-mono">
            {new Date(data.collectedAt).toLocaleTimeString()}
          </span>
          <button onClick={refresh} className="text-sm text-muted-foreground hover:text-foreground transition">
            Refresh
          </button>
        </div>
      </div>

      {metricsDown && system.error && (
        <div className="rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/20 p-4 text-sm text-amber-600 dark:text-amber-400">
          <span className="font-medium">{t("monitoring.prometheusUnavailable")}</span>{" "}
          {system.error}
        </div>
      )}
      {error && (
        <div className="rounded-2xl bg-destructive/10 ring-1 ring-destructive/20 p-4 text-sm text-destructive">
          {t("monitoring.refreshFailed", { error })}
        </div>
      )}

      {/* Overview Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label={t("monitoring.roomsWithParticipants")}
          value={`${data.rooms.active} / ${data.rooms.total}`}
          icon={Radio}
          accent="primary"
          hint={t("monitoring.hintDepartureTimeout")}
        />
        <StatsCard
          label={t("monitoring.participants")}
          value={`${data.participants.total}`}
          icon={Users}
          accent="blue"
          trend={data.participants.avgPerRoom}
          trendLabel={t("monitoring.hintAvgPerRoom", { avg: data.participants.avgPerRoom })}
        />
        <StatsCard
          label={t("monitoring.capacity")}
          value={capacity.utilization === null ? "n/a" : `${capacity.utilization}%`}
          icon={Gauge}
          accent={capacity.utilization !== null && capacity.utilization > 80 ? "destructive" : "amber"}
        />
        <StatsCard
          label={t("monitoring.recordings")}
          value={`${data.recordings.active}`}
          icon={Disc}
          accent="default"
        />
      </div>

      {/* Process metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          label={t("monitoring.cpu")}
          value={system.cpuPercent === null ? "n/a" : `${system.cpuPercent.toFixed(0)}%`}
          icon={Cpu}
          accent="primary"
          hint={system.cpuPercent === null ? t("monitoring.hintNeedsTwoSamples") : t("monitoring.hintProcess")}
        />
        <StatsCard
          label={t("monitoring.ram")}
          value={system.ramBytes === null ? "n/a" : formatBytesShort(system.ramBytes)}
          icon={MemoryStick}
          accent="blue"
          hint={t("monitoring.hintProcess")}
        />
        <StatsCard
          label={t("monitoring.network")}
          value={
            system.networkRxBytes === null
              ? "n/a"
              : `↓${formatBytesShort(system.networkRxBytes)} ↑${
                  system.networkTxBytes === null ? "n/a" : formatBytesShort(system.networkTxBytes)
                }`
          }
          icon={Activity}
          accent="amber"
          hint={t("monitoring.hintSinceStart")}
        />
        <StatsCard
          label={t("monitoring.uptime")}
          value={formatUptime(system.uptimeSeconds)}
          icon={Activity}
          accent="default"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MetricChart
          title={t("monitoring.cpu")}
          description="Share of one core used by livekit-server"
          series={cpuSeries}
          data={history}
          height={220}
          emptyLabel="Waiting for a second sample to compute CPU time"
        />
        <MetricChart
          title={t("monitoring.ram")}
          description="Resident memory of livekit-server"
          series={memorySeries}
          data={history}
          height={220}
        />
        <MetricChart
          title={t("monitoring.packetLoss")}
          description="Share of forwarded packets dropped"
          series={lossSeries}
          data={history}
          height={220}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MetricChart
          title={t("monitoring.network")}
          description="Packets sent by the server since start"
          series={trafficSeries}
          data={history}
          height={200}
        />

        {/* Measured transport metrics */}
        <div className="rounded-2xl bg-card ring-1 ring-border p-5">
          <h3 className="text-sm font-semibold mb-1">{t("monitoring.webrtc")}</h3>
          <p className="text-xs text-muted-foreground mb-4">Reported by the server's media pipeline</p>
          <div className="space-y-4">
            {qualityBars.map((m) => (
              <div key={m.l}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{m.l}</span>
                  <span className="font-mono tabular-nums font-medium">{m.v}</span>
                </div>
                {m.p !== null && <Progress value={m.p} className="h-1.5" />}
                <div className="text-[10px] text-muted-foreground mt-1">{m.hint}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Active Rooms */}
        <div className="rounded-2xl bg-card ring-1 ring-border p-5">
          <h3 className="text-sm font-semibold mb-1">Active Rooms</h3>
          <p className="text-xs text-muted-foreground mb-4">Real-time room status</p>
          <div className="space-y-2 max-h-[300px] overflow-auto scrollbar-thin">
            {data.roomDetails.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No active rooms</div>
            ) : (
              data.roomDetails.map((room) => (
                <Link
                  key={room.sid}
                  href={`/rooms/${room.name}`}
                  className="flex items-center justify-between rounded-xl bg-accent/30 ring-1 ring-border p-3 hover:ring-ring/30 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="size-8 rounded-lg bg-primary/15 ring-1 ring-primary/20 grid place-items-center shrink-0">
                      <Radio className="size-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold font-mono truncate">{room.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {room.participants} participants
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {room.recording && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive bg-destructive/10 ring-1 ring-destructive/20 px-2 py-0.5 rounded-full">
                        <Disc className="size-2.5 animate-pulse-dot" /> REC
                      </span>
                    )}
                    <StatusBadge
                      variant={room.participants > 0 ? "live" : "idle"}
                      pulse={room.participants > 0}
                    >
                      {room.participants > 0 ? "Live" : "Idle"}
                    </StatusBadge>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
