import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/session'
import { getLiveKitConfig, isLiveKitConfigured, getRoomService } from '@/lib/livekit-server'
import {
  isAuthConfigured,
  isDatabaseConfigured,
  metricsUrl,
} from '@/lib/env'

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Server configuration and reachability.
 *
 * Authenticated because it reports the cluster URL, whether credentials are
 * set, and how many rooms exist — enough to map a deployment without login.
 *
 * Every value here is read from the environment or from the cluster. Presence of
 * a secret is reported as a boolean, never as the value: the settings page needs
 * to answer "is this set", and the browser must never learn the contents.
 */
export async function GET(req: NextRequest) {
  const identity = await authenticate(req.headers)
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const cfg = getLiveKitConfig()
  const configured = isLiveKitConfigured()

  let connectionStatus = "unknown"
  let roomCount = 0
  let error: string | null = null

  if (configured) {
    try {
      const svc = getRoomService()
      const rooms = await svc.listRooms()
      roomCount = rooms.length
      connectionStatus = "connected"
    } catch (err) {
      connectionStatus = "error"
      error = err instanceof Error ? err.message : "Unknown error"
    }
  } else {
    connectionStatus = "not_configured"
  }

  const metrics = metricsUrl()

  return NextResponse.json({
    configured,
    url: cfg.url,
    hasApiKey: Boolean(cfg.apiKey),
    hasApiSecret: Boolean(cfg.apiSecret),
    region: cfg.region,
    connectionStatus,
    roomCount,
    error,
    // Everything below is what the settings page shows about this dashboard's own
    // wiring, so an operator can tell "not configured" from "broken".
    metricsUrl: metrics,
    databaseConfigured: isDatabaseConfigured(),
    sessionSecretConfigured: isAuthConfigured(),
  })
}