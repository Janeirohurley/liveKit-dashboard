import { NextRequest, NextResponse } from "next/server"
import { authenticate } from "@/lib/auth/session"
import { audit } from "@/lib/auth/audit"
import { isLiveKitConfigured } from "@/lib/livekit-server"
import { getLiveKitAdapter } from "@/lib/livekit/adapter"
import type { ParticipantDTO, RoomDTO } from "@/lib/livekit/adapter"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Participant search across the cluster.
 *
 * This predates `lib/livekit/adapter` and used to build its own shape with raw
 * `RoomService` calls, including a `new Date(joinedAt * 1000)` conversion that
 * was wrong: LiveKit reports `joinedAt` in milliseconds, so every join time was
 * off by three orders of magnitude. It now delegates to the adapter, and DELETE
 * removes a participant, so both verbs are authenticated and audited.
 */

function flatten(rooms: RoomDTO[], participantsByRoom: Map<string, ParticipantDTO[]>) {
  const out: Array<{
    room: string
    identity: string
    sid: string
    state: ParticipantDTO['state']
    isPublisher: boolean
    trackCount: number
    joinedAt: string | null
  }> = []
  for (const room of rooms) {
    for (const p of participantsByRoom.get(room.name) ?? []) {
      out.push({
        room: room.name,
        identity: p.identity,
        sid: p.sid,
        state: p.state,
        isPublisher: p.isPublisher,
        trackCount: p.tracks.length,
        joinedAt: p.joinedAtMs ? new Date(Number(p.joinedAtMs)).toISOString() : null,
      })
    }
  }
  return out
}

/** One participant list per room; a room that errors is skipped, not fatal. */
async function participantsByRoom(rooms: RoomDTO[]) {
  const adapter = getLiveKitAdapter()
  const entries = await Promise.all(
    rooms.map(async (room) => {
      try {
        return [room.name, await adapter.listParticipants(room.name)] as const
      } catch {
        return [room.name, [] as ParticipantDTO[]] as const
      }
    }),
  )
  return new Map(entries)
}

export async function GET(req: NextRequest) {
  const identity = await authenticate(req.headers)
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  if (!isLiveKitConfigured()) {
    return NextResponse.json({ error: "LiveKit is not configured." }, { status: 400 })
  }

  const url = new URL(req.url)
  const searchIdentity = url.searchParams.get("identity")
  const roomName = url.searchParams.get("room")

  try {
    const adapter = getLiveKitAdapter()

    if (roomName) {
      const participants = await adapter.listParticipants(roomName)
      await audit({
        adminId: identity.id,
        adminEmail: identity.email,
        action: "participant.list",
        targetType: "room",
        targetId: roomName,
        metadata: { count: participants.length },
      })
      return NextResponse.json({ room: roomName, participants })
    }

    const rooms = await adapter.listRooms()
    const byRoom = await participantsByRoom(rooms)
    const all = flatten(rooms, byRoom)

    const participants = searchIdentity
      ? all.filter((p) => p.identity === searchIdentity)
      : all

    return NextResponse.json({
      participants,
      totalRooms: rooms.length,
      ...(searchIdentity ? {} : { totalParticipants: all.length }),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  const identity = await authenticate(req.headers)
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  if (!isLiveKitConfigured()) {
    return NextResponse.json({ error: "LiveKit is not configured." }, { status: 400 })
  }

  try {
    const body = await req.json()
    const { room, identity: participantIdentity } = body ?? {}

    if (!room || !participantIdentity) {
      return NextResponse.json({ error: "Room and identity are required." }, { status: 400 })
    }

    const adapter = getLiveKitAdapter()
    await adapter.removeParticipant(room, participantIdentity)
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: "participant.remove",
      targetType: "room",
      targetId: room,
      metadata: { participant: participantIdentity },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    )
  }
}
