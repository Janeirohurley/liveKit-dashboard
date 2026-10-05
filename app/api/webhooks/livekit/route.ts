import { NextResponse } from "next/server"
import { getWebhookReceiver, isLiveKitConfigured } from "@/lib/livekit-server"
import { recordWebhookEvent } from "@/lib/webhook-store"
import { publish } from "@/lib/events/bus"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * LiveKit webhook receiver.
 * Configure your LiveKit project to POST events to this URL with
 * Content-Type: application/webhook+json
 *
 * The body is a signed JWT (Authorization header) plus a JSON payload.
 * We use WebhookReceiver to validate the signature against your API key+secret.
 */
export async function POST(req: Request) {
  if (!isLiveKitConfigured()) {
    return NextResponse.json({ error: "LiveKit is not configured." }, { status: 400 })
  }

  let event: Awaited<ReturnType<ReturnType<typeof getWebhookReceiver>["receive"]>>
  try {
    const auth = req.headers.get("authorization") ?? ""
    const body = await req.text()
    const receiver = getWebhookReceiver()
    // skipAuth is deliberately not passed: an unsigned webhook is rejected.
    event = await receiver.receive(body, auth)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid webhook" },
      { status: 401 },
    )
  }

  const name = event.event ?? "unknown"
  const createdAt = Number(event.createdAt ?? Math.floor(Date.now() / 1000))
  const record = {
    id: event.id ?? crypto.randomUUID(),
    event: name,
    createdAt,
    room: event.room?.name,
    participant: event.participant?.identity,
    trackSid: event.track?.sid,
    egressId: event.egressInfo?.egressId,
    raw: event,
  }

  // Acknowledge the event even if storage fails: the event is already
  // authenticated, and a 500 would make LiveKit redeliver it forever.
  const stored = await recordWebhookEvent(record)

  publish({
    id: record.id,
    event: record.event,
    createdAt: record.createdAt,
    room: record.room,
    participant: record.participant,
    trackSid: record.trackSid,
    egressId: record.egressId,
  })

  return NextResponse.json({ ok: true, stored })
}

export async function GET() {
  return NextResponse.json({
    info: "POST LiveKit webhook events here. Set Content-Type: application/webhook+json.",
  })
}
