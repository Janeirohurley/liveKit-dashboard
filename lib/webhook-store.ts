/**
 * Persistent webhook event store.
 *
 * Replaces the earlier in-memory array: a dashboard that loses its event log
 * on every deploy cannot answer "who joined that room at 14:02", and an
 * in-memory buffer is also per-process, so a multi-instance deployment shows
 * each replica a different history.
 *
 * Two rules matter:
 *
 *   1. Recording must never break the webhook response. If Postgres is down
 *      the event is dropped and the failure is logged, exactly like `audit()`.
 *      LiveKit retries on a non-2xx, and a 500 caused by our own storage
 *      would loop forever on an event that is already accepted.
 *   2. The table is append-only and trimmed by age, never rewritten.
 */

import { getDb } from '@/lib/db'
import type { StoredWebhookEvent } from '@/lib/events/types'

export type { StoredWebhookEvent }

/** Events older than this are pruned, bounding unbounded growth. */
export const EVENT_RETENTION_DAYS = 14

export interface RecordEventInput {
  id: string
  event: string
  createdAt: number
  room?: string
  participant?: string
  trackSid?: string
  egressId?: string
  raw?: unknown
}

interface EventRow {
  id: string
  event: string
  created_at: string | number
  room_name: string | null
  participant_identity: string | null
  track_sid: string | null
  egress_id: string | null
  payload: unknown
}

function toDTO(row: EventRow): StoredWebhookEvent {
  return {
    id: row.id,
    event: row.event,
    createdAt: Number(row.created_at),
    room: row.room_name ?? undefined,
    participant: row.participant_identity ?? undefined,
    trackSid: row.track_sid ?? undefined,
    egressId: row.egress_id ?? undefined,
    raw: row.payload,
  }
}

export async function recordWebhookEvent(e: RecordEventInput): Promise<boolean> {
  try {
    const sql = await getDb()
    await sql`
      insert into dashboard_webhook_events
        (id, event, room_name, participant_identity, track_sid, created_at,
         egress_id, payload)
      values
        (${e.id}, ${e.event}, ${e.room ?? null}, ${e.participant ?? null},
         ${e.trackSid ?? null}, ${e.createdAt}, ${e.egressId ?? null},
         ${sql.json((e.raw ?? {}) as never)})
      on conflict (id) do nothing
    `
    return true
  } catch (error) {
    console.error(
      '[webhook-store] write failed for',
      e.event,
      '-',
      error instanceof Error ? error.message : error,
    )
    return false
  }
}

export interface ListEventsQuery {
  limit?: number
  room?: string
  event?: string
}

export async function listWebhookEvents(
  query: ListEventsQuery = {},
): Promise<StoredWebhookEvent[]> {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000)
  const sql = await getDb()
  const rows = await sql<EventRow[]>`
    select id, event, created_at, room_name, participant_identity, track_sid,
           egress_id, payload
      from dashboard_webhook_events
     where (${query.room ?? null}::text is null or room_name = ${query.room ?? null})
       and (${query.event ?? null}::text is null or event = ${query.event ?? null})
     order by created_at desc
     limit ${limit}
  `
  return rows.map(toDTO)
}

/** Distinct rooms and event names, for the filter dropdowns. */
export async function listWebhookFacets(): Promise<{
  rooms: string[]
  eventTypes: string[]
}> {
  const sql = await getDb()
  const rooms = await sql<{ room_name: string }[]>`
    select distinct room_name
      from dashboard_webhook_events
     where room_name is not null
     order by room_name
     limit 200
  `
  const types = await sql<{ event: string }[]>`
    select distinct event
      from dashboard_webhook_events
     order by event
     limit 200
  `
  return {
    rooms: rooms.map((r) => r.room_name),
    eventTypes: types.map((t) => t.event),
  }
}

/** Delete events older than the retention window. */
export async function pruneWebhookEvents(
  retentionDays: number = EVENT_RETENTION_DAYS,
): Promise<number> {
  const sql = await getDb()
  const rows = await sql<{ count: string }[]>`
    with deleted as (
      delete from dashboard_webhook_events
       where created_at < (extract(epoch from now()) - ${retentionDays * 86400})::bigint
      returning 1
    )
    select count(*) as count from deleted
  `
  return Number(rows[0]?.count ?? 0)
}

/**
 * Clear the log. Bounded by `before` so this cannot be used to wipe recent
 * history by accident; callers pass an epoch-seconds cutoff.
 */
export async function clearWebhookEvents(before?: number): Promise<number> {
  const sql = await getDb()
  const rows = await sql<{ count: string }[]>`
    with deleted as (
      delete from dashboard_webhook_events
       where ${before ?? 0}::bigint = 0 or created_at < ${before ?? 0}::bigint
      returning 1
    )
    select count(*) as count from deleted
  `
  return Number(rows[0]?.count ?? 0)
}
