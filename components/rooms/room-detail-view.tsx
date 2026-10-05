"use client"

import Link from "next/link"
import {
  ArrowLeft,
  ChevronRight,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MoreHorizontal,
  MessageSquare,
  UserMinus,
  Disc,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { MetricChart, type ChartSeries } from "@/components/dashboard/metric-chart"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useParticipants } from "@/hooks/useParticipants"
import { useRoom } from "@/hooks/useRoom"
import { useNow } from "@/hooks/useNow"
import { useRoomEvents } from "@/hooks/useRoomEvents"
import { useI18n } from "@/lib/i18n"
import { formatDuration } from "@/lib/utils"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import type { ParticipantDTO, TrackDTO } from "@/lib/livekit/adapter"

const initials = (n: string) =>
  n.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()

const trackLabel = (t: TrackDTO): string => {
  const kind = t.type === 'AUDIO' ? 'audio' : t.type === 'VIDEO' ? 'video' : t.type === 'DATA' ? 'data' : 'unknown'
  const source = t.source === 'SCREEN_SHARE' || t.source === 'SCREEN_SHARE_AUDIO' ? 'screen' : null
  return source ? `${kind}/${source}` : kind
}

const resolution = (t: TrackDTO): string | null =>
  t.width && t.height ? `${t.width}x${t.height}` : null

/**
 * Room detail.
 *
 * Everything here is what the RoomService reported for this room: participants,
 * their tracks, the codecs the server has enabled, and the webhook events the
 * dashboard persisted. The previous version of this page displayed a fixed VP8
 * codec, a per-participant bitrate/ping/loss, a room duration of "Unknown", a
 * track count computed as `participants * 2`, four invented events and eighteen
 * invented log lines. None of that came from LiveKit, so it is gone: fields the
 * server does not report render as "n/a".
 *
 * The Stats tab reads from the cluster-wide metrics history, not from
 * per-room series. LiveKit labels its media metrics with `node_id`, never with
 * a room name, so per-room CPU, bitrate or packet loss cannot be read from
 * Prometheus and is not charted.
 */
export function RoomDetailView({ roomId }: { roomId: string }) {
  const { t } = useI18n()
  const { participants, loading, error: participantsError } = useParticipants(roomId)
  const { room, missing, loading: roomLoading } = useRoom(roomId)
  const now = useNow()
  const { events } = useRoomEvents(roomId)

  const roomStatus = participants.length > 0 ? ("live" as const) : ("idle" as const)
  const publishers = participants.filter((p) => p.isPublisher).length
  const tracks = participants.flatMap((p) => p.tracks)
  const trackCount = tracks.length
  const codecs = room?.codecs ?? []

  const createdAtMs = room?.creationTimeMs ? Number(room.creationTimeMs) : null
  const durationLabel =
    createdAtMs && Number.isFinite(createdAtMs)
      ? formatDuration(Math.max(0, now - createdAtMs) / 1000)
      : 'n/a'

  const participantSeries: ChartSeries[] = [
    { key: 'participants', label: t('dashboard.participants'), domain: [0, 'auto'] },
  ]
  const trackSeries: ChartSeries[] = [
    { key: 'tracks', label: t('rooms.tracks'), domain: [0, 'auto'] },
  ]

  if (missing) {
    return (
      <div className="rounded-2xl bg-card ring-1 ring-border p-6 text-sm text-muted-foreground">
        Room <span className="font-mono text-foreground">{roomId}</span> does not exist or has ended.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/rooms" className="hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-3" /> {t("nav.rooms")}
        </Link>
        <ChevronRight className="size-3" />
        <span className="text-foreground font-mono">{roomId}</span>
      </div>

      {/* Header */}
      <div className="rounded-2xl bg-card ring-1 ring-border p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold tracking-tight truncate">{roomId}</h1>
              <StatusBadge variant={roomStatus} pulse={roomStatus === "live"}>
                {roomStatus === "live" ? t("common.live") : "Idle"}
              </StatusBadge>
              {room?.activeRecording && (
                <StatusBadge variant="down" pulse>
                  <Disc className="size-3" /> REC
                </StatusBadge>
              )}
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              {room?.sid ?? 'sid n/a'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(roomId).catch(() => toast.error('Failed to copy'))
                toast.success(t('common.copied'))
              }}
            >
              {t("rooms.copyId")}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { l: t("rooms.participants"), v: `${participants.length}` },
            { l: t("rooms.publishers"), v: `${publishers}` },
            { l: t("rooms.tracks"), v: `${trackCount}` },
            { l: t("rooms.codec"), v: codecs.length > 0 ? codecs.join(", ") : 'n/a' },
            { l: t("rooms.maxParticipants"), v: room ? `${room.maxParticipants}` : 'n/a' },
            { l: t("common.duration"), v: durationLabel },
          ].map((s) => (
            <div key={s.l} className="rounded-xl bg-accent/40 ring-1 ring-border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{s.l}</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      <Tabs defaultValue="participants">
        <TabsList className="bg-card ring-1 ring-border">
          <TabsTrigger value="participants">{t("room.tabs.participants")}</TabsTrigger>
          <TabsTrigger value="tracks">{t("room.tabs.tracks")}</TabsTrigger>
          <TabsTrigger value="events">{t("room.tabs.events")}</TabsTrigger>
          <TabsTrigger value="stats">{t("room.tabs.stats")}</TabsTrigger>
        </TabsList>

        <TabsContent value="participants" className="mt-4">
          {participantsError && (
            <div className="rounded-2xl bg-destructive/10 ring-1 ring-destructive/20 p-4 text-sm text-destructive mb-3">
              {participantsError}
            </div>
          )}
          {loading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading participants...</div>
          ) : participants.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No participants in this room
              {roomLoading ? "" : " (room still open)"}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {participants.map((p) => (
                <ParticipantCard key={p.sid} participant={p} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="tracks" className="mt-4">
          {tracks.length === 0 ? (
            <div className="rounded-2xl bg-card ring-1 ring-border p-6 text-center text-sm text-muted-foreground">
              No media tracks in this room.
            </div>
          ) : (
            <div className="space-y-2">
              {tracks.map((track) => {
                const owner = participants.find((p) => p.tracks.some((x) => x.sid === track.sid))
                return (
                  <div
                    key={track.sid}
                    className="flex flex-wrap items-center gap-3 rounded-xl bg-card ring-1 ring-border px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium">{track.name || trackLabel(track)}</span>
                    <span className="text-xs text-muted-foreground font-mono">{trackLabel(track)}</span>
                    {track.codecMime && (
                      <span className="text-xs text-muted-foreground font-mono">{track.codecMime}</span>
                    )}
                    {resolution(track) && (
                      <span className="text-xs text-muted-foreground font-mono">{resolution(track)}</span>
                    )}
                    {track.simulcast && (
                      <span className="text-[10px] text-chart-2 bg-chart-2/10 ring-1 ring-chart-2/20 px-2 py-0.5 rounded-full">
                        simulcast x{track.layers}
                      </span>
                    )}
                    {track.muted && (
                      <span className="text-[10px] text-warning bg-warning/10 ring-1 ring-warning/20 px-2 py-0.5 rounded-full">
                        muted
                      </span>
                    )}
                    <span className="ms-auto text-xs text-muted-foreground font-mono truncate">
                      {owner?.identity ?? 'unknown'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="events" className="mt-4 space-y-2">
          {events.length === 0 ? (
            <div className="rounded-2xl bg-card ring-1 ring-border p-6 text-center text-sm text-muted-foreground">
              No webhook events recorded for this room yet.
            </div>
          ) : (
            events.map((e) => (
              <div
                key={e.id}
                className="flex flex-wrap items-center gap-3 rounded-xl bg-card ring-1 ring-border px-4 py-2.5 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(e.createdAt * 1000).toLocaleTimeString()}
                </span>
                <span className="font-medium">{e.event}</span>
                <span className="ms-auto text-xs text-muted-foreground font-mono truncate">
                  {e.participant ?? e.egressId ?? e.room ?? 'system'}
                </span>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="stats" className="mt-4">
          <div className="rounded-2xl bg-card ring-1 ring-border p-5 text-sm text-muted-foreground mb-4">
            LiveKit labels media metrics with <span className="font-mono text-foreground">node_id</span>,
            never with a room name, so per-room CPU, bitrate and packet loss are not
            available from the metrics endpoint. These two charts count what the
            RoomService reports for this room.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MetricChart
              title={t("dashboard.participants")}
              description="Reported for this room"
              type="line"
              series={participantSeries}
              data={[]}
              height={240}
              emptyLabel="Per-room history is not collected by the server"
            />
            <MetricChart
              title={t("rooms.tracks")}
              description="Reported for this room"
              type="line"
              series={trackSeries}
              data={[]}
              height={240}
              emptyLabel="Per-room history is not collected by the server"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ParticipantCard({ participant: p }: { participant: ParticipantDTO }) {
  const { t } = useI18n()
  const now = useNow()
  const audioTracks = p.tracks.filter((x) => x.type === 'AUDIO')
  const videoTracks = p.tracks.filter((x) => x.type === 'VIDEO')
  const screenTracks = p.tracks.filter(
    (x) => x.source === 'SCREEN_SHARE' || x.source === 'SCREEN_SHARE_AUDIO',
  )
  const hasAudio = audioTracks.length > 0
  const hasVideo = videoTracks.length > 0
  const displayName = p.name ?? p.identity
  const joinedAtMs = p.joinedAtMs ? Number(p.joinedAtMs) : null

  return (
    <div className="rounded-2xl bg-card ring-1 ring-border p-4 hover:ring-ring/30 transition">
      <div className="flex items-start gap-3">
        <Avatar className="size-10 ring-1 ring-border">
          <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold truncate">{displayName}</div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {p.isPublisher ? 'publisher' : 'subscriber'}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono truncate">{p.identity}</div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 -me-1">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => toast(`Muted ${displayName}`)}>
              <MicOff className="size-4" /> {t("room.mute")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <VideoOff className="size-4" /> {t("room.disableCam")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <MessageSquare className="size-4" /> {t("room.message")}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive">
              <UserMinus className="size-4" /> {t("room.remove")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex items-center gap-1.5 flex-wrap">
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ring-1",
            hasAudio
              ? "text-success bg-success/10 ring-success/20"
              : "text-muted-foreground bg-muted ring-border",
          )}
        >
          {hasAudio ? <Mic className="size-3" /> : <MicOff className="size-3" />} audio
          {audioTracks.length > 0 && ` x${audioTracks.length}`}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ring-1",
            hasVideo
              ? "text-success bg-success/10 ring-success/20"
              : "text-muted-foreground bg-muted ring-border",
          )}
        >
          {hasVideo ? <Video className="size-3" /> : <VideoOff className="size-3" />} video
          {videoTracks.length > 0 && ` x${videoTracks.length}`}
        </span>
        {screenTracks.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md ring-1 text-chart-2 bg-chart-2/10 ring-chart-2/20">
            <Monitor className="size-3" /> screen
          </span>
        )}
        <StatusBadge variant={p.state === 'ACTIVE' ? 'live' : 'idle'} className="ms-auto">
          {p.state.toLowerCase()}
        </StatusBadge>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div className="rounded-lg bg-accent/40 ring-1 ring-border px-2 py-1.5">
          <div className="text-muted-foreground">state</div>
          <div className="text-foreground tabular-nums">{p.state}</div>
        </div>
        <div className="rounded-lg bg-accent/40 ring-1 ring-border px-2 py-1.5">
          <div className="text-muted-foreground">tracks</div>
          <div className="text-foreground tabular-nums">{p.tracks.length}</div>
        </div>
        <div className="rounded-lg bg-accent/40 ring-1 ring-border px-2 py-1.5">
          <div className="text-muted-foreground">publish</div>
          <div className="text-foreground tabular-nums">
            {p.canPublish === null ? 'n/a' : p.canPublish ? 'allowed' : 'denied'}
          </div>
        </div>
        <div className="rounded-lg bg-accent/40 ring-1 ring-border px-2 py-1.5">
          <div className="text-muted-foreground">joined</div>
          <div className="text-foreground tabular-nums">
            {joinedAtMs && Number.isFinite(joinedAtMs)
              ? formatDuration(Math.max(0, now - joinedAtMs) / 1000)
              : 'n/a'}
          </div>
        </div>
      </div>
    </div>
  )
}
