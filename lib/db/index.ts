/**
 * PostgreSQL access for the three things the dashboard must persist:
 * admin accounts, the audit trail and (Phase 2) the webhook event history.
 *
 * The LiveKit server itself is NOT in Postgres — rooms, participants and
 * tracks are read live from the RoomService API and are never cached here.
 */

import postgres from 'postgres'
import { databaseUrl } from '@/lib/env'

/**
 * pg types. Kept deliberately loose (`unknown`) at the call sites so that a
 * schema mistake surfaces as a null in the UI rather than a fabricated value:
 * the adapter maps missing fields to `null`, never to a default.
 */
export type Row = Record<string, unknown>

/**
 * Tagged template that logs the query on failure. Named `sql` to match the
 * driver's own ergonomics at call sites.
 */
export type Sql = postgres.Sql

let client: Sql | null = null

/**
 * Lazily created singleton. Next.js reloads modules in dev, so the promise is
 * cached on globalThis to avoid leaking a connection pool per hot reload.
 */
const globalForDb = globalThis as unknown as {
  __dashboardSql?: Promise<Sql>
}

export function getDb(): Promise<Sql> {
  if (client) return Promise.resolve(client)
  if (globalForDb.__dashboardSql) return globalForDb.__dashboardSql

  const created = (async () => {
    const sql = postgres(databaseUrl(), {
      max: 5,
      // Keep numeric/boolean columns as strings only where Postgres needs it;
      // bigint columns in the audit table arrive as strings by default, which
      // we convert explicitly at the call site.
      onnotice: () => {},
    })
    await sql`select 1`
    return sql
  })()

  client = null // do not memoize the failure-prone instance directly
  globalForDb.__dashboardSql = created
  return created
}

/** Close the pool. Used by tests and by graceful shutdown. */
export async function closeDb(): Promise<void> {
  const pending = globalForDb.__dashboardSql
  globalForDb.__dashboardSql = undefined
  client = null
  if (!pending) return
  try {
    const sql = await pending
    await sql.end({ timeout: 5 })
  } catch {
    // Pool was never opened or is already gone; nothing to release.
  }
}
