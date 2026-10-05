import { NextRequest, NextResponse } from "next/server"
import { authenticate } from "@/lib/auth/session"
import { audit } from "@/lib/auth/audit"
import { createAccessToken, isLiveKitConfigured, type TokenGrants } from "@/lib/livekit-server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Mint access tokens.
 *
 * Authenticated and audited: this route holds the cluster API secret and will
 * mint a token for any identity the caller names. Left open it is an
 * unauthenticated way into every room on the deployment.
 */
export async function POST(req: NextRequest) {
  const identity = await authenticate(req.headers)
  if (!identity) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  if (!isLiveKitConfigured()) {
    return NextResponse.json({ error: "LiveKit is not configured." }, { status: 400 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 })
  }

  const invalid = validateGrants(body)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  try {
    const grants = body as TokenGrants
    const token = await createAccessToken(grants)
    await audit({
      adminId: identity.id,
      adminEmail: identity.email,
      action: "token.create",
      targetType: "participant",
      targetId: grants.identity,
      metadata: { room: grants.room ?? null, canPublish: grants.canPublish ?? null },
    })
    return NextResponse.json({
      token,
      url: process.env.LIVEKIT_URL,
      identity: grants.identity,
      expiresIn: grants.ttlSeconds ?? 21600,
    })
  } catch (err) {
    // A rejected grant (e.g. an unknown track source) is the caller's mistake,
    // not a server fault, so report it as a 400 rather than a 500.
    const message = err instanceof Error ? err.message : "Unknown error"
    const status = /unknown track source|grants must include/i.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

const BOOLEAN_GRANTS = [
  "roomJoin",
  "canPublish",
  "canSubscribe",
  "canPublishData",
  "canUpdateOwnMetadata",
  "hidden",
  "recorder",
  "roomCreate",
  "roomList",
  "roomRecord",
  "roomAdmin",
  "ingressAdmin",
  "sipAdmin",
  "sipCall",
] as const

const TRACK_SOURCES = new Set([
  "camera",
  "microphone",
  "screen_share",
  "screen_share_audio",
])

const MAX_TTL_SECONDS = 24 * 60 * 60

/**
 * Validate the request body before it reaches `createAccessToken`.
 *
 * Without this the handler forwarded whatever JSON arrived: a non-string
 * `identity` was signed into the token, `ttlSeconds: "abc"` became `NaN` in the
 * expiry, and a non-array `canPublishSources` threw out of the mapping. Those
 * surfaced as 500s, which tells the operator the dashboard is broken when the
 * mistake was in the request. Returns a message, or null when the body is good.
 */
function validateGrants(body: unknown): string | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object."
  }
  const g = body as Record<string, unknown>

  if (typeof g.identity !== "string" || !g.identity.trim()) {
    return "identity is required and must be a non-empty string."
  }
  for (const key of ["room", "name", "metadata"] as const) {
    if (g[key] !== undefined && typeof g[key] !== "string") {
      return `${key} must be a string when provided.`
    }
  }
  for (const key of BOOLEAN_GRANTS) {
    if (g[key] !== undefined && typeof g[key] !== "boolean") {
      return `${key} must be a boolean when provided.`
    }
  }
  if (g.ttlSeconds !== undefined) {
    if (typeof g.ttlSeconds !== "number" || !Number.isFinite(g.ttlSeconds) || g.ttlSeconds <= 0) {
      return "ttlSeconds must be a positive number when provided."
    }
    if (g.ttlSeconds > MAX_TTL_SECONDS) {
      return `ttlSeconds must not exceed ${MAX_TTL_SECONDS} (24 hours).`
    }
  }
  if (g.canPublishSources !== undefined) {
    if (
      !Array.isArray(g.canPublishSources) ||
      g.canPublishSources.some((s) => typeof s !== "string")
    ) {
      return "canPublishSources must be an array of strings."
    }
    const unknown = (g.canPublishSources as string[]).filter((s) => !TRACK_SOURCES.has(s))
    if (unknown.length > 0) {
      return `Unknown track source${unknown.length > 1 ? "s" : ""} ${unknown
        .map((s) => `"${s}"`)
        .join(", ")}. Expected one of: ${[...TRACK_SOURCES].join(", ")}.`
    }
  }
  return null
}
