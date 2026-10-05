/**
 * LiveKit Server SDK Configuration & Initialization
 *
 * This module initializes and manages LiveKit SDK clients for:
 * - Room management (RoomServiceClient)
 * - Access token generation (AccessToken)
 * - Webhook validation (WebhookReceiver)
 * - Egress recording (EgressClient)
 *
 * All clients require LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET env vars.
 */

import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
  EgressClient,
  TrackSource,
  type VideoGrant,
} from 'livekit-server-sdk'

// Configuration interface
export interface LiveKitConfig {
  url: string | undefined
  apiKey: string | undefined
  apiSecret: string | undefined
  region: string
}

/**
 * Token grants for creating access tokens.
 *
 * Mirrors the SDK's VideoGrant and SIPGrant. Every field is optional and maps to
 * one grant field — the token UI used to send `canPublishSources`,
 * `roomAdmin`, `sipCall` and friends, and `createAccessToken` silently dropped
 * everything past `canPublishData`, so the operator saw a permission they were
 * not actually granting.
 */
export interface TokenGrants {
  identity: string
  room?: string
  roomJoin?: boolean
  canPublish?: boolean
  canSubscribe?: boolean
  canPublishData?: boolean
  canPublishSources?: string[]
  canUpdateOwnMetadata?: boolean
  hidden?: boolean
  recorder?: boolean
  roomCreate?: boolean
  roomList?: boolean
  roomRecord?: boolean
  roomAdmin?: boolean
  ingressAdmin?: boolean
  sipAdmin?: boolean
  sipCall?: boolean
  ttlSeconds?: number
  name?: string
  metadata?: string
}

/**
 * Get LiveKit configuration from environment variables
 */
export function getLiveKitConfig(): LiveKitConfig {
  return {
    url: process.env.LIVEKIT_URL,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    region: process.env.LIVEKIT_REGION ?? 'auto',
  }
}

/**
 * Check if LiveKit is properly configured
 */
export function isLiveKitConfigured(): boolean {
  const cfg = getLiveKitConfig()
  return Boolean(cfg.url && cfg.apiKey && cfg.apiSecret)
}

/**
 * Get or create RoomServiceClient singleton
 * Used for: listRooms, deleteRoom, listParticipants, removeParticipant, mutePublishedTrack
 */
let roomServiceInstance: RoomServiceClient | null = null

export function getRoomService(): RoomServiceClient {
  if (roomServiceInstance) {
    return roomServiceInstance
  }

  const cfg = getLiveKitConfig()
  if (!isLiveKitConfigured()) {
    throw new Error('LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.')
  }

  roomServiceInstance = new RoomServiceClient(cfg.url!, cfg.apiKey, cfg.apiSecret)
  return roomServiceInstance
}

/**
 * Get or create EgressClient singleton
 * Used for: listEgress, startRoomCompositeEgress, stopEgress
 */
let egressClientInstance: EgressClient | null = null

export function getEgressClient(): EgressClient {
  if (egressClientInstance) {
    return egressClientInstance
  }

  const cfg = getLiveKitConfig()
  if (!isLiveKitConfigured()) {
    throw new Error('LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.')
  }

  egressClientInstance = new EgressClient(cfg.url!, cfg.apiKey, cfg.apiSecret)
  return egressClientInstance
}

/**
 * Get or create WebhookReceiver singleton
 * Used for: receive and validate LiveKit webhook events
 */
let webhookReceiverInstance: WebhookReceiver | null = null

export function getWebhookReceiver(): WebhookReceiver {
  if (webhookReceiverInstance) {
    return webhookReceiverInstance
  }

  const cfg = getLiveKitConfig()
  if (!isLiveKitConfigured()) {
    throw new Error('LiveKit is not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.')
  }

  webhookReceiverInstance = new WebhookReceiver(cfg.apiKey!, cfg.apiSecret!)
  return webhookReceiverInstance
}

/**
 * Create an access token for a participant to join a room
 *
 * @param grants Token grants (identity, room, permissions, ttl)
 * @returns JWT token string
 *
 * Example:
 *   const token = await createAccessToken({
 *     identity: 'user-123',
 *     room: 'my-room',
 *     canPublish: true,
 *     canSubscribe: true,
 *     ttlSeconds: 3600,
 *   })
 */
/**
 * Track sources arrive from the browser as the strings LiveKit documents
 * ("camera", "microphone", …), but VideoGrant wants the protocol enum. Passing
 * the strings straight through makes the SDK throw "Cannot convert TrackSource
 * camera to string" while signing, so translate here and reject anything
 * unrecognised rather than minting a token with a silently dropped grant.
 */
const TRACK_SOURCE_BY_NAME: Record<string, TrackSource> = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
}

export async function createAccessToken(grants: TokenGrants): Promise<string> {
  const cfg = getLiveKitConfig()
  if (!isLiveKitConfigured()) {
    throw new Error('LiveKit is not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET.')
  }

  if (!grants.identity) {
    throw new Error('Token grants must include identity.')
  }

  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: grants.identity,
    name: grants.name,
    metadata: grants.metadata,
    ttl: grants.ttlSeconds ? Math.floor(grants.ttlSeconds) : 6 * 60 * 60, // default 6 hours
  })

  let canPublishSources: TrackSource[] | undefined
  if (grants.canPublishSources?.length) {
    canPublishSources = grants.canPublishSources.map((name) => {
      const source = TRACK_SOURCE_BY_NAME[name]
      if (source === undefined) {
        throw new Error(
          `Unknown track source "${name}". Expected one of: ${Object.keys(TRACK_SOURCE_BY_NAME).join(', ')}.`,
        )
      }
      return source
    })
  }

  // Video grant. Omitted fields stay absent rather than becoming false, because
  // the SDK treats "unset" as "default" — for example canPublishData defaults to
  // true when unset, so writing an explicit false would be a real decision.
  const videoGrant: VideoGrant = {
    roomJoin: grants.roomJoin ?? true,
    room: grants.room || '',
    canPublish: grants.canPublish ?? false,
    canSubscribe: grants.canSubscribe ?? false,
    canPublishData: grants.canPublishData ?? false,
    canPublishSources,
    canUpdateOwnMetadata: grants.canUpdateOwnMetadata,
    hidden: grants.hidden,
    recorder: grants.recorder,
    roomCreate: grants.roomCreate,
    roomList: grants.roomList,
    roomRecord: grants.roomRecord,
    roomAdmin: grants.roomAdmin,
    ingressAdmin: grants.ingressAdmin,
  }

  at.addGrant(videoGrant)

  if (grants.sipAdmin || grants.sipCall) {
    at.addSIPGrant({ admin: grants.sipAdmin, call: grants.sipCall })
  }

  return await at.toJwt()
}
