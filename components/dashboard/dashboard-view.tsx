"use client"

import Link from "next/link"
import { Activity, Cpu, MemoryStick, Users, Radio, Clock4, Plug, Disc, ArrowRight } from "lucide-react"
import { StatsCard } from "@/components/dashboard/stats-card"
import { MetricChart, type ChartSeries } from "@/components/dashboard/metric-chart"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { useRooms } from "@/hooks/useRooms"
import { useConfig } from "@/hooks/useConfig"
import { useMonitoring } from "@/hooks/useMonitoring"
import { useNow } from "@/hooks/useNow"
import { formatDuration } from "@/lib/utils"
import { formatBytesShort, formatUptime } from "@/lib/metrics/format"

/**
 * Dashboard KPIs are read, never derived from a made-up formula.
 *
 * The previous version invented CPU from `participants / 500`, hardcoded RAM at
 * 58%, a stream count, a transport count, an uptime, and node/region text. Any
 * of those can be wrong in the direction that matters — a full-looking cluster
 * that is actually saturated — so each tile now renders "n/a" unless a source
 * reports the number.
 */
export function DashboardView() {
  const { t } = useI18n()
  const { rooms } = useRooms()
  const { config } = useConfig()
  const { data: monitoring } = useMonitoring()
  const now = useNow()

  // A room exists in LiveKit only while someone is in it or it is within its
  // departure timeout, so the room count is the count of live rooms — no status
  // field to invent. LiveKit reports no per-room bitrate, so there is no
  // bandwidth tile here.
  const activeRoomsCount = rooms.length
  const liveParticipants = rooms.reduce((sum, r) => sum + r.numParticipants, 0)
  const publishers = monitoring?.participants.publishers ?? null
  const uptime = monitoring?.system.uptimeSeconds ?? null

  const history = monitoring?.history ?? []

  const participantsSeries: ChartSeries[] = [
    { key: "participants", label: t("dashboard.participants"), domain: [0, "auto"] },
  ]
  const memorySeries: ChartSeries[] = [
    {
      key: "residentMemoryBytes",
      label: t("dashboard.ram"),
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

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight text-balance">{t("dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge variant="live" pulse>
            {t("common.live")}
          </StatusBadge>
          {monitoring?.collectedAt && (
            <span className="text-xs text-muted-foreground font-mono">
              {new Date(monitoring.collectedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label={t("dashboard.activeRooms")} value={activeRoomsCount} icon={Radio} accent="primary" />
        <StatsCard label={t("dashboard.participants")} value={liveParticipants} icon={Users} accent="blue" />
        <StatsCard
          label={t("dashboard.bandwidth")}
          value="n/a"
          icon={Activity}
          accent="amber"
          hint="not reported per room"
        />
        <StatsCard
          label={t("dashboard.cpu")}
          value={monitoring?.system.cpuPercent != null ? `${monitoring.system.cpuPercent.toFixed(0)}%` : "n/a"}
          icon={Cpu}
          accent="primary"
          hint={monitoring?.system.cpuPercent == null ? "needs two samples" : "livekit process"}
        />
        <StatsCard
          label={t("dashboard.ram")}
          value={monitoring?.system.ramBytes != null ? formatBytesShort(monitoring.system.ramBytes) : "n/a"}
          icon={MemoryStick}
          accent="blue"
          hint="livekit process"
        />
        <StatsCard
          label="Publishers"
          value={publishers ?? "n/a"}
          icon={Plug}
          accent="default"
        />
        <StatsCard
          label={t("dashboard.uptime")}
          value={formatUptime(uptime)}
          icon={Clock4}
          accent="default"
          hint="livekit process"
        />
        <StatsCard
          label="Recordings"
          value={monitoring?.recordings.active ?? "n/a"}
          icon={Disc}
          accent="amber"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MetricChart
          title={t("dashboard.participantsChart")}
          description="Measured peers across all rooms"
          series={participantsSeries}
          data={history}
          className="lg:col-span-2"
          height={260}
        />
        <MetricChart
          title={t("dashboard.cpuRamChart")}
          description="LiveKit process memory"
          series={memorySeries}
          data={history}
          height={260}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <MetricChart
          title={t("dashboard.trafficChart")}
          description="Packets sent by the server"
          series={trafficSeries}
          data={history}
          height={220}
        />

        {/* LiveKit configuration */}
        <div className="rounded-2xl bg-card ring-1 ring-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">{t("dashboard.nodeHealth")}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">LiveKit configuration</p>
            </div>
            <Link href="/settings" className="text-xs text-primary hover:underline">
              {t("common.viewAll")}
            </Link>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="rounded-xl bg-accent/40 ring-1 ring-border p-4">
              <div className="font-semibold">Server URL</div>
              <div className="text-xs">{config?.url ?? "Not configured"}</div>
            </div>
            <div className="rounded-xl bg-accent/40 ring-1 ring-border p-4">
              <div className="font-semibold">API Key</div>
              <div className="text-xs">{config?.hasApiKey ? "Configured" : "Missing"}</div>
            </div>
            <div className="rounded-xl bg-accent/40 ring-1 ring-border p-4">
              <div className="font-semibold">API Secret</div>
              <div className="text-xs">{config?.hasApiSecret ? "Configured" : "Missing"}</div>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className="rounded-2xl bg-card ring-1 ring-border p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">{t("dashboard.activity")}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Recent room events</p>
            </div>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
              <Link href="/rooms">
                {t("common.viewAll")} <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </div>
          <ul className="space-y-1.5">
            {rooms.length === 0 ? (
              <li className="rounded-xl px-3 py-6 text-center text-xs text-muted-foreground">
                {t("dashboard.noRooms")}
              </li>
            ) : (
              rooms.map((r) => {
                const createdMs = r.creationTimeMs ? Number(r.creationTimeMs) : null
                return (
                  <li
                    key={r.name}
                    className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-accent/60 transition"
                  >
                    <div className="size-7 rounded-lg bg-primary/10 ring-1 ring-primary/20 grid place-items-center">
                      <Radio className="size-3.5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{r.name}</div>
                      <div className="text-[11px] text-muted-foreground font-mono">
                        {r.numParticipants} peers •{" "}
                        {createdMs ? formatDuration(Math.max(0, now - createdMs)) : "n/a"}
                      </div>
                    </div>
                    <StatusBadge variant="live" pulse>
                      {t("common.live")}
                    </StatusBadge>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
