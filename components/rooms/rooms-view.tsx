"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  Search,
  MoreHorizontal,
  Eye,
  Trash2,
  Copy,
  Plus,
  Mic,
  Video,
  Disc,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input as NumberInput } from "@/components/ui/input"
import { useRooms } from "@/hooks/useRooms"
import { useNow } from "@/hooks/useNow"
import { useI18n } from "@/lib/i18n"
import { toast } from "sonner"
import { cn, formatDuration } from "@/lib/utils"

export function RoomsView() {
  const { t } = useI18n()
  const { rooms, loading, error, refetch } = useRooms()
  const now = useNow()
  const [query, setQuery] = useState("")
  const [recordingOnly, setRecordingOnly] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [roomName, setRoomName] = useState("")
  const [maxParticipants, setMaxParticipants] = useState("")
  const [metadata, setMetadata] = useState("")
  const [isCreating, setIsCreating] = useState(false)
  const [busyRoom, setBusyRoom] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rooms.filter((r) => {
      const matchQuery = !q || r.name.toLowerCase().includes(q) || r.sid.toLowerCase().includes(q)
      const matchRecording = !recordingOnly || r.activeRecording
      return matchQuery && matchRecording
    })
  }, [rooms, query, recordingOnly])

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.name))

  function toggleAll() {
    const next = new Set(selected)
    if (allSelected) filtered.forEach((r) => next.delete(r.name))
    else filtered.forEach((r) => next.add(r.name))
    setSelected(next)
  }

  function toggleRow(name: string) {
    const next = new Set(selected)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setSelected(next)
  }

  async function createRoom() {
    const name = roomName.trim()
    if (!name) {
      toast.error(t("rooms.nameRequired"))
      return
    }

    setIsCreating(true)
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          maxParticipants: maxParticipants ? Number(maxParticipants) : undefined,
          metadata: metadata.trim() || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      const data = await res.json()
      toast.success(t("rooms.created", { name: data.room?.name ?? name }))
      setRoomName("")
      setMaxParticipants("")
      setMetadata("")
      setDialogOpen(false)
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("rooms.createFailed"))
    } finally {
      setIsCreating(false)
    }
  }

  /** Returns true when the room is gone, so a bulk delete can stop on failure. */
  async function deleteRoom(name: string): Promise<boolean> {
    setBusyRoom(name)
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(name)}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      toast.success(t("rooms.deleted"))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(name)
        return next
      })
      await refetch()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("rooms.deleteFailed"))
      return false
    } finally {
      setBusyRoom(null)
    }
  }

  async function deleteSelected() {
    const names = [...selected]
    if (names.length === 0) return
    // Sequential: deleting a room is irreversible and an operator selecting six
    // should be able to stop after the third.
    for (const name of names) {
      const ok = await deleteRoom(name)
      if (!ok) break
    }
    setSelected(new Set())
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{t("rooms.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("rooms.subtitle")}</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> {t("rooms.new")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("rooms.createTitle")}</DialogTitle>
              <DialogDescription>{t("rooms.createDescription")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="new-room-name" className="block text-sm font-medium text-muted-foreground">
                  {t("rooms.roomName")}
                </label>
                <Input
                  id="new-room-name"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder={t("rooms.roomNamePlaceholder")}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="new-room-max" className="block text-sm font-medium text-muted-foreground">
                  {t("rooms.maxParticipants")}
                </label>
                <NumberInput
                  id="new-room-max"
                  type="number"
                  min={1}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(e.target.value)}
                  placeholder={t("rooms.maxParticipantsPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="new-room-metadata" className="block text-sm font-medium text-muted-foreground">
                  {t("rooms.metadata")}
                </label>
                <Input
                  id="new-room-metadata"
                  value={metadata}
                  onChange={(e) => setMetadata(e.target.value)}
                  placeholder={t("rooms.metadataPlaceholder")}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" type="button" onClick={() => setDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={createRoom} disabled={isCreating}>
                {isCreating && <Loader2 className="size-4 animate-spin" />}
                {isCreating ? t("rooms.creating") : t("rooms.createAction")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Toolbar */}
      <div className="rounded-2xl bg-card ring-1 ring-border p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="size-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("common.search")}
            className="ps-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground px-2">
          <Checkbox
            checked={recordingOnly}
            onCheckedChange={(v) => setRecordingOnly(v === true)}
            aria-label={t("rooms.recordingOnly")}
          />
          {t("rooms.recordingOnly")}
        </label>
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ms-auto">
            <span className="text-xs text-muted-foreground">
              {t("rooms.selected", { count: selected.size })}
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={deleteSelected}
              disabled={busyRoom !== null}
            >
              <Trash2 className="size-4" /> {t("rooms.deleteSelected")}
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl bg-card ring-1 ring-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label={t("rooms.selectAll")}
                />
              </TableHead>
              <TableHead>{t("rooms.name")}</TableHead>
              <TableHead className="text-end">{t("rooms.participants")}</TableHead>
              <TableHead className="text-end">{t("rooms.publishers")}</TableHead>
              <TableHead>{t("rooms.codec")}</TableHead>
              <TableHead className="text-end">{t("common.created")}</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rooms.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                  {t("rooms.loading")}
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="h-32 text-center text-sm text-destructive">
                  {error}
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                  {t("rooms.empty")}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const isBusy = busyRoom === r.name
                return (
                  <TableRow
                    key={r.name}
                    className={cn("border-border", selected.has(r.name) && "bg-accent/40")}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(r.name)}
                        onCheckedChange={() => toggleRow(r.name)}
                        aria-label={t("rooms.selectRow")}
                      />
                    </TableCell>
                    <TableCell>
                      <Link href={`/rooms/${encodeURIComponent(r.name)}`} className="group flex items-center gap-3">
                        <div className="size-8 rounded-lg bg-primary/10 ring-1 ring-primary/20 grid place-items-center">
                          <Mic className="size-3.5 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium group-hover:text-primary transition truncate">
                            {r.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground font-mono truncate">{r.sid}</div>
                        </div>
                        {r.activeRecording && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive bg-destructive/10 ring-1 ring-destructive/20 px-1.5 py-0.5 rounded-md ms-2">
                            <Disc className="size-2.5 animate-pulse-dot" /> REC
                          </span>
                        )}
                      </Link>
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      <span className="font-medium">{r.numParticipants}</span>
                      {r.maxParticipants > 0 && (
                        <span className="text-muted-foreground"> / {r.maxParticipants}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{r.numPublishers}</TableCell>
                    <TableCell>
                      {r.codecs.length > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-mono px-1.5 py-0.5 rounded-md bg-accent ring-1 ring-border">
                          <Video className="size-3" /> {r.codecs.join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("rooms.noCodecs")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-end tabular-nums text-sm text-muted-foreground">
                      {r.creationTimeMs
                        ? formatDuration(
                            Math.max(0, now - Number(r.creationTimeMs)),
                          )
                        : t("common.unknown")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8" disabled={isBusy}>
                            {isBusy ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="size-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem asChild>
                            <Link href={`/rooms/${encodeURIComponent(r.name)}`}>
                              <Eye className="size-4" /> {t("rooms.inspect")}
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              navigator.clipboard
                                .writeText(r.name)
                                .then(() => toast.success(t("common.copied")))
                                .catch(() => toast.error(t("rooms.copyFailed")))
                            }}
                          >
                            <Copy className="size-4" /> {t("rooms.copyName")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => deleteRoom(r.name)}
                          >
                            <Trash2 className="size-4" /> {t("rooms.deleteRoom")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {t("rooms.showing", { shown: filtered.length, total: rooms.length })}
      </p>
    </div>
  )
}