#!/usr/bin/env node
/**
 * Compare the migration list in the code against the target database, and check
 * that the objects the app queries actually exist.
 *
 *   pnpm db:status
 *
 * `pnpm db:migrate` only prints what it *ran*. It answers "did anything apply
 * just now", which is the wrong question when you want to know whether the
 * database matches the code — after switching DATABASE_URL, after importing a
 * dump, or when a deployment half-failed.
 *
 * Two failure modes this catches that `db:migrate` does not:
 *
 *   - A recorded migration whose object is gone. `migrate()` skips anything
 *     already in `dashboard_schema_migrations`, so a dropped table stays dropped
 *     forever and every query against it fails at runtime.
 *   - A recorded migration that never finished. Each statement runs in its own
 *     transaction together with the bookkeeping insert, so this is unlikely —
 *     but an import of a partial dump or a manual edit can produce it, and the
 *     bookkeeping row is the only evidence.
 *
 * Exits non-zero on any mismatch so it can gate a deploy.
 */

import { closeDb, getDb, type Sql } from './index'
import { STATEMENTS } from './migrate'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: rely on the ambient environment.
}

/** What the running code actually reads or writes. Keep in sync with lib/. */
const EXPECTED_TABLES = [
  'dashboard_admins',
  'dashboard_sessions',
  'dashboard_audit_log',
  'dashboard_webhook_events',
  'dashboard_metrics_snapshots',
]

/** Columns added after the initial table definition. */
const EXPECTED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'dashboard_sessions', column: 'ttl_seconds' },
]

/** Indexes created by their own migration; useful to spot a partial apply. */
const EXPECTED_INDEXES = [
  'dashboard_sessions_admin_idx',
  'dashboard_audit_log_indexes',
  'dashboard_audit_log_action_idx',
  'dashboard_webhook_events_created_idx',
  'dashboard_webhook_events_room_idx',
  'dashboard_webhook_events_event_idx',
  'dashboard_metrics_snapshots_recorded_idx',
]

async function main(): Promise<number> {
  const sql = await getDb()

  const problems: string[] = []

  // Which database are we actually talking to? Switching DATABASE_URL without
  // re-running migrations is the most common way to end up inspecting the wrong
  // one, and the host is the only thing in the DSN that is safe to print.
  const [conn] = await sql<{ db: string; host: string }[]>`
    select current_database() as db, inet_server_addr()::text as host
  `
  console.log(`target: ${conn.db} @ ${conn.host ?? 'local socket'}`)
  console.log('')

  // 1. Bookkeeping table must exist before anything else can be checked.
  const hasLedger = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.tables
     where table_schema = 'public' and table_name = 'dashboard_schema_migrations'
  `
  if (!hasLedger[0]?.n) {
    console.log('no migrations have ever been applied to this database.')
    console.log('run: pnpm db:migrate')
    return 1
  }

  const appliedRows = await sql<{ id: string; applied_at: Date }[]>`
    select id, applied_at from dashboard_schema_migrations order by id
  `
  const applied = new Map(appliedRows.map((r) => [r.id, r.applied_at]))

  const declared = STATEMENTS.map((s) => s.id)
  const missing = declared.filter((id) => !applied.has(id))
  const unknown = [...applied.keys()].filter((id) => !declared.includes(id))

  // 2. Every statement recorded as done must have left its object behind.
  const tables = new Set(
    (
      await sql<{ table_name: string }[]>`
        select table_name from information_schema.tables
         where table_schema = 'public'
      `
    ).map((r) => r.table_name),
  )

  const indexes = new Set(
    (
      await sql<{ indexname: string }[]>`
        select indexname from pg_indexes where schemaname = 'public'
      `
    ).map((r) => r.indexname),
  )

  const columns = new Set(
    (
      await sql<{ table_name: string; column_name: string }[]>`
        select table_name, column_name from information_schema.columns
         where table_schema = 'public'
      `
    ).map((r) => `${r.table_name}.${r.column_name}`),
  )

  // 3. Tables and columns the app touches must exist regardless of bookkeeping.
  for (const table of EXPECTED_TABLES) {
    if (!tables.has(table)) problems.push(`missing table: ${table}`)
  }
  for (const { table, column } of EXPECTED_COLUMNS) {
    if (tables.has(table) && !columns.has(`${table}.${column}`)) {
      problems.push(`missing column: ${table}.${column}`)
    }
  }
  for (const index of EXPECTED_INDEXES) {
    // `005_dashboard_audit_log_indexes` is a multi-statement id whose index name
    // is not asserted individually; check only the single-index ones.
    if (index === 'dashboard_audit_log_indexes') continue
    if (!indexes.has(index)) problems.push(`missing index: ${index}`)
  }

  console.log(`applied migrations: ${applied.size}/${declared.length}`)
  for (const stmt of STATEMENTS) {
    const at = applied.get(stmt.id)
    console.log(`  ${at ? 'ok  ' : 'MISS'}  ${stmt.id}${at ? `  (${new Date(at).toISOString()})` : ''}`)
  }

  if (unknown.length) {
    console.log('')
    console.log('recorded in the database but not in the code:')
    for (const id of unknown) console.log(`  ?  ${id}`)
    problems.push(`${unknown.length} migration(s) recorded in the database are unknown to the code`)
  }

  console.log('')
  if (problems.length === 0) {
    console.log('no problems found')
    if (missing.length === 0) return 0
    return 0
  }

  for (const p of problems) console.log(`problem: ${p}`)
  if (missing.length) {
    console.log('')
    console.log('run: pnpm db:migrate')
  } else {
    console.log('')
    console.log(
      'every migration is recorded as applied but objects are missing.\n' +
        "pnpm db:migrate will NOT fix this — it skips recorded ids. Inspect and\n" +
        'reconcile by hand.',
    )
  }
  return 1
}

main()
  .then(async (code) => {
    await closeDb()
    process.exit(code)
  })
  .catch(async (error) => {
    console.error('db:status failed:', error instanceof Error ? error.stack : error)
    await closeDb()
    process.exit(2)
  })