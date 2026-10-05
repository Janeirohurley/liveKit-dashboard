/**
 * LiveKitAdapter — single source of truth between dashboard and LiveKit APIs.
 */

import {
  AgentDispatchClient,
  EgressClient,
  EgressStatus,
  IngressClient,
  ParticipantInfo_State,
  RoomServiceClient,
  SipClient,
  TrackSource,
  TrackType,
  type ParticipantInfo,
  type Room,
  type TrackInfo,
} from 'livekit-server-sdk'
import { liveKitConfig } from '@/lib/env'

function getCfg() {
  return liveKitConfig()
}

export type Availability = 'available' | 'unavailable' | 'unsupported'

export interface AdapterHealth {
  ok: boolean
  liveKitUrl: string
  roomService: Availability
  egress: Availability
  ingress: Availability
  sip: Availability
  agents: Availability
  error?: string
}

export interface RoomDTO {
  name: string
  sid: string
  numParticipants: number
  numPublishers: number
  numSubscribers: number | null
  emptyTimeout: number
  departureTimeout: number | null
  maxParticipants: number
  creationTimeMs: string | null
  metadata: string
  activeRecording: boolean
  turnPasswordPresent: boolean
  codecs: string[]
}

export interface TrackDTO {
  sid: string
  type: 'AUDIO' | 'VIDEO' | 'DATA' | 'UNKNOWN'
  source: 'CAMERA' | 'MICROPHONE' | 'SCREEN_SHARE' | 'SCREEN_SHARE_AUDIO' | 'UNKNOWN'
  name: string
  muted: boolean
  stream: string | null
  simulcast: boolean
  mid: string | null
  width: number | null
  height: number | null
  codecMime: string | null
  layers: number
}

export interface ParticipantDTO {
  identity: string
  sid: string
  state: 'JOINING' | 'JOINED' | 'ACTIVE' | 'DISCONNECTED' | 'LEFT' | 'RECONNECTING' | 'UNKNOWN'
  joinedAtMs: string | null
  name: string | null
  metadata: string | null
  attributes: Record<string, string>
  isPublisher: boolean
  canPublish: boolean | null
  canSubscribe: boolean | null
  canPublishData: boolean | null
  tracks: TrackDTO[]
}

function mapTrackType(t: TrackInfo['type']): TrackDTO['type'] {
  switch (t) {
    case TrackType.AUDIO:
      return 'AUDIO'
    case TrackType.VIDEO:
      return 'VIDEO'
    case TrackType.DATA:
      return 'DATA'
    default:
      return 'UNKNOWN'
  }
}

function mapTrackSource(s: TrackInfo['source']): TrackDTO['source'] {
  switch (s) {
    case TrackSource.CAMERA:
      return 'CAMERA'
    case TrackSource.MICROPHONE:
      return 'MICROPHONE'
    case TrackSource.SCREEN_SHARE:
      return 'SCREEN_SHARE'
    case TrackSource.SCREEN_SHARE_AUDIO:
      return 'SCREEN_SHARE_AUDIO'
    default:
      return 'UNKNOWN'
  }
}

/**
 * LiveKit's protocol enum only declares JOINING/JOINED/ACTIVE/DISCONNECTED,
 * but servers may send newer numeric states. Map by number so an unexpected
 * value degrades to UNKNOWN instead of throwing at the UI.
 */
const PARTICIPANT_STATE: Record<number, ParticipantDTO['state']> = {
  [ParticipantInfo_State.JOINING]: 'JOINING',
  [ParticipantInfo_State.JOINED]: 'JOINED',
  [ParticipantInfo_State.ACTIVE]: 'ACTIVE',
  [ParticipantInfo_State.DISCONNECTED]: 'DISCONNECTED',
  4: 'LEFT',
  5: 'RECONNECTING',
}

function mapParticipantState(s: ParticipantInfo['state']): ParticipantDTO['state'] {
  return PARTICIPANT_STATE[s] ?? 'UNKNOWN'
}

function toTrackDTO(t: TrackInfo): TrackDTO {
  return {
    sid: t.sid,
    type: mapTrackType(t.type),
    source: mapTrackSource(t.source),
    name: t.name ?? '',
    muted: Boolean(t.muted),
    stream: t.stream ?? null,
    simulcast: Boolean(t.simulcast),
    mid: t.mid ?? null,
    width: typeof t.width === 'number' && t.width > 0 ? t.width : null,
    height: typeof t.height === 'number' && t.height > 0 ? t.height : null,
    codecMime: t.mimeType ?? t.codecs?.[0]?.mimeType ?? null,
    layers: Array.isArray(t.layers) ? t.layers.length : 0,
  }
}

function toParticipantDTO(p: ParticipantInfo): ParticipantDTO {
  return {
    identity: p.identity,
    sid: p.sid,
    state: mapParticipantState(p.state),
    joinedAtMs: p.joinedAtMs != null ? String(p.joinedAtMs) : p.joinedAt != null ? String(p.joinedAt) : null,
    name: p.name ?? null,
    metadata: p.metadata ?? null,
    attributes: (p.attributes ?? {}) as Record<string, string>,
    isPublisher: Boolean(p.isPublisher),
    canPublish: p.permission?.canPublish ?? null,
    canSubscribe: p.permission?.canSubscribe ?? null,
    canPublishData: p.permission?.canPublishData ?? null,
    tracks: (p.tracks ?? []).map(toTrackDTO),
  }
}

function toRoomDTO(r: Room): RoomDTO {
  return {
    name: r.name,
    sid: r.sid,
    numParticipants: r.numParticipants ?? 0,
    numPublishers: r.numPublishers ?? 0,
    // Not present on every protocol version; null rather than a fabricated 0.
    numSubscribers: (r as { numSubscribers?: number }).numSubscribers ?? null,
    emptyTimeout: r.emptyTimeout ?? 0,
    departureTimeout: r.departureTimeout ?? null,
    maxParticipants: r.maxParticipants ?? 0,
    creationTimeMs: r.creationTimeMs != null ? String(r.creationTimeMs) : r.creationTime != null ? String(r.creationTime) : null,
    metadata: r.metadata ?? '',
    activeRecording: Boolean(r.activeRecording),
    turnPasswordPresent: Boolean(r.turnPassword),
    codecs: (r.enabledCodecs ?? []).map((c: any) => c.mime).filter(Boolean),
  }
}

export class LiveKitAdapter {
  private rs: RoomServiceClient
  private eg: EgressClient
  private ig: IngressClient
  private sip: SipClient
  private ad: AgentDispatchClient

  constructor() {
    const cfg = getCfg()
    this.rs = new RoomServiceClient(cfg.url, cfg.apiKey, cfg.apiSecret)
    this.eg = new EgressClient(cfg.url, cfg.apiKey, cfg.apiSecret)
    this.ig = new IngressClient(cfg.url, cfg.apiKey, cfg.apiSecret)
    this.sip = new SipClient(cfg.url, cfg.apiKey, cfg.apiSecret)
    this.ad = new AgentDispatchClient(cfg.url, cfg.apiKey, cfg.apiSecret)
  }

  async listRooms(): Promise<RoomDTO[]> {
    const rooms = await this.rs.listRooms()
    return rooms.map(toRoomDTO)
  }

  async getRoom(name: string): Promise<RoomDTO | null> {
    const rooms = await this.rs.listRooms()
    const r = rooms.find((x) => x.name === name)
    return r ? toRoomDTO(r) : null
  }

  /**
   * Create an empty room.
   *
   * LiveKit will create a room on first join anyway, so this exists for
   * operators who need it to exist up front with specific limits or metadata.
   */
  async createRoom(options: {
    name: string
    emptyTimeout?: number
    departureTimeout?: number
    maxParticipants?: number
    metadata?: string
  }): Promise<RoomDTO> {
    const room = await this.rs.createRoom({
      name: options.name,
      ...(options.emptyTimeout !== undefined ? { emptyTimeout: options.emptyTimeout } : {}),
      ...(options.departureTimeout !== undefined ? { departureTimeout: options.departureTimeout } : {}),
      ...(options.maxParticipants !== undefined ? { maxParticipants: options.maxParticipants } : {}),
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    })
    return toRoomDTO(room)
  }

  async deleteRoom(name: string): Promise<void> {
    await this.rs.deleteRoom(name)
  }

  async listParticipants(roomName: string): Promise<ParticipantDTO[]> {
    const parts = await this.rs.listParticipants(roomName)
    return parts.map(toParticipantDTO)
  }

  async getParticipant(roomName: string, identity: string): Promise<ParticipantDTO | null> {
    try {
      const p = await this.rs.getParticipant(roomName, identity)
      return toParticipantDTO(p)
    } catch (e: any) {
      const code = e?.code
      if (code === 5 || code === 'not_found') return null
      throw e
    }
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    await this.rs.removeParticipant(roomName, identity)
  }

  async mutePublishedTrack(roomName: string, identity: string, trackSid: string, muted: boolean): Promise<void> {
    await this.rs.mutePublishedTrack(roomName, identity, trackSid, muted)
  }

  async updateParticipant(roomName: string, identity: string, payload: { metadata?: string; name?: string; attributes?: Record<string, string> }): Promise<void> {
    await this.rs.updateParticipant(roomName, identity, payload as any)
  }

  async listIngress(): Promise<unknown[]> {
    const items = await this.ig.listIngress()
    return items as unknown[]
  }

  async listEgress(): Promise<unknown[]> {
    const items = await this.eg.listEgress()
    return items as unknown[]
  }

  /**
   * Egress jobs still running.
   *
   * `listEgress()` returns finished jobs too — LiveKit keeps them for
   * `history_limit` — so callers counting "recordings happening now" have to
   * filter on status themselves. Done here once rather than in each caller.
   */
  async listActiveEgress(): Promise<unknown[]> {
    const items = (await this.eg.listEgress()) as Array<{ status?: number }>
    const running: number[] = [
      EgressStatus.EGRESS_STARTING,
      EgressStatus.EGRESS_ACTIVE,
      EgressStatus.EGRESS_ENDING,
    ]
    return items.filter((e) => e.status !== undefined && running.includes(e.status))
  }

  async listSipTrunks(): Promise<unknown[]> {
    const items = await this.sip.listSipTrunk()
    return items as unknown[]
  }

  async listAgentDispatch(roomName: string): Promise<unknown[]> {
    try {
      const d = await this.ad.listDispatch(roomName)
      return d as unknown[]
    } catch (e: any) {
      const msg = e?.message ?? ''
      if (msg.includes('no response from servers')) return []
      throw e
    }
  }

  async health(): Promise<AdapterHealth> {
    const cfg = getCfg()
    const h: AdapterHealth = {
      ok: true,
      liveKitUrl: cfg.url,
      roomService: 'unavailable',
      egress: 'unavailable',
      ingress: 'unavailable',
      sip: 'unavailable',
      agents: 'unavailable',
    }
    try {
      await this.rs.listRooms()
      h.roomService = 'available'
    } catch (e: any) {
      h.ok = false
      h.error = e?.message ?? String(e)
    }
    try {
      await this.eg.listEgress()
      h.egress = 'available'
    } catch {}
    try {
      await this.ig.listIngress()
      h.ingress = 'available'
    } catch {}
    try {
      await this.sip.listSipTrunk()
      h.sip = 'available'
    } catch {}
    try {
      const rooms = await this.rs.listRooms().catch(() => [])
      if (rooms[0]?.name) {
        await this.ad.listDispatch(rooms[0].name)
      }
      h.agents = 'available'
    } catch {}
    return h
  }
}

let adapterInstance: LiveKitAdapter | null = null

export function getLiveKitAdapter(): LiveKitAdapter {
  if (!adapterInstance) {
    adapterInstance = new LiveKitAdapter()
  }
  return adapterInstance
}

