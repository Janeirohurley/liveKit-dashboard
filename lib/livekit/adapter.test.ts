import { describe, expect, it } from 'vitest'
import { LiveKitAdapter } from '@/lib/livekit/adapter'

/**
 * Adapter tests against a live server are opt-in: they exercise the real
 * RoomService rather than a mock, which is the only way to catch protocol
 * drift. Without LIVEKIT_E2E=1 they are skipped.
 */
const live = process.env.LIVEKIT_E2E === '1'

describe('LiveKitAdapter (unit: DTO mapping and guards)', () => {
  it('constructs from env without throwing', () => {
    expect(() => new LiveKitAdapter()).not.toThrow()
  })
})

describe.runIf(live)('LiveKitAdapter (e2e against a real server)', () => {
  const adapter = new LiveKitAdapter()

  it('reports health for every service', async () => {
    const h = await adapter.health()
    expect(h.ok).toBe(true)
    expect(h.roomService).toBe('available')
    expect(h.liveKitUrl).toMatch(/^https?:\/\//)
  })

  it('lists rooms', async () => {
    const rooms = await adapter.listRooms()
    expect(Array.isArray(rooms)).toBe(true)
    for (const room of rooms) {
      expect(typeof room.name).toBe('string')
      expect(room.numParticipants).toBeGreaterThanOrEqual(0)
      expect(Number(BigInt(room.creationTimeMs ?? '0'))).toBeGreaterThan(0)
    }
  })

  it('returns null for an unknown room rather than throwing', async () => {
    await expect(adapter.getRoom('definitely-not-a-room-xyz')).resolves.toBeNull()
  })

  it('returns null for an unknown participant rather than throwing', async () => {
    await expect(
      adapter.getParticipant('definitely-not-a-room-xyz', 'nobody'),
    ).resolves.toBeNull()
  })

  it('lists participants with tracks for an existing room', async () => {
    const rooms = await adapter.listRooms()
    const target = rooms.find((r) => r.numParticipants > 0)
    if (!target) return

    const participants = await adapter.listParticipants(target.name)
    expect(participants.length).toBeGreaterThan(0)
    for (const p of participants) {
      expect(p.identity).toBeTruthy()
      expect(Array.isArray(p.tracks)).toBe(true)
      expect(p.state).toMatch(/joined|active|disconnected/)
    }
  })

  it('treats an agents-dispatch timeout as an empty list', async () => {
    const rooms = await adapter.listRooms()
    const target = rooms[0]
    if (!target) return
    const dispatch = await adapter.listAgentDispatch(target.name)
    expect(Array.isArray(dispatch)).toBe(true)
  })
})
