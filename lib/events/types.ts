/**
 * Shared event types.
 *
 * Kept separate from `lib/webhook-store` so a client component can import the
 * shape without pulling in the Postgres connection: the store imports
 * `getDb()`, and a type-only import is erased at build time but a careless
 * later change to a value import would drag `postgres` into the browser bundle.
 */

export type StoredWebhookEvent = {
  id: string
  event: string
  /** Unix seconds, as sent by LiveKit. */
  createdAt: number
  room?: string
  participant?: string
  trackSid?: string
  egressId?: string
  raw: unknown
}
