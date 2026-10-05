/**
 * Schema migrations, applied idempotently on boot.
 *
 * Every statement is `IF NOT EXISTS`, so `pnpm db:migrate` can run on every
 * deploy and against an already-populated database without failing. That also
 * makes it safe to point at a shared Postgres: the dashboard only ever
 * creates `dashboard_*` tables, never touches anything else.
 *
 * There is deliberately no ORM: three tables do not justify one, and the
 * audit log benefits from being a plain append-only table.
 */

import type { Sql } from '@/lib/db'

/**
 * Ordered list of statements. Append only — never edit a shipped entry,
 * because deployed databases have already run it.
 */
export const STATEMENTS: Array<{ id: string; sql: string }> = [
  {
    id: '001_dashboard_admins',
    sql: `
      create table if not exists dashboard_admins (
        id              text primary key,
        email           text not null unique,
        name            text not null,
        password_hash   text not null,
        role            text not null default 'admin'
                          check (role in ('admin', 'viewer')),
        -- Bumped on password change to invalidate every existing session.
        token_version   integer not null default 1,
        created_at      timestamptz not null default now(),
        last_login_at   timestamptz,
        disabled_at     timestamptz
      )
    `,
  },
  {
    id: '002_dashboard_sessions',
    sql: `
      create table if not exists dashboard_sessions (
        id            text primary key,
        admin_id      text not null references dashboard_admins (id) on delete cascade,
        token_version integer not null,
        created_at    timestamptz not null default now(),
        expires_at    timestamptz not null,
        last_seen_at  timestamptz,
        revoked_at    timestamptz,
        ip            text,
        user_agent    text
      )
    `,
  },
  {
    id: '003_dashboard_sessions_indexes',
    sql: `
      create index if not exists dashboard_sessions_admin_idx
        on dashboard_sessions (admin_id)
    `,
  },
  {
    id: '004_dashboard_audit_log',
    sql: `
      create table if not exists dashboard_audit_log (
        id          bigserial primary key,
        admin_id    text references dashboard_admins (id) on delete set null,
        admin_email text not null,
        action      text not null,
        target_type text,
        target_id   text,
        -- Only non-sensitive context. Passwords, tokens and secrets are never
        -- written here; see lib/auth/audit.ts for the redaction rules.
        metadata    jsonb not null default '{}'::jsonb,
        ok          boolean not null default true,
        ip          text,
        created_at  timestamptz not null default now()
      )
    `,
  },
  {
    id: '005_dashboard_audit_log_indexes',
    sql: `
      create index if not exists dashboard_audit_log_created_idx
        on dashboard_audit_log (created_at desc)
    `,
  },
  {
    id: '006_dashboard_audit_log_action_idx',
    sql: `
      create index if not exists dashboard_audit_log_action_idx
        on dashboard_audit_log (action, created_at desc)
    `,
  },
  {
    id: '007_dashboard_webhook_events',
    sql: `
      create table if not exists dashboard_webhook_events (
        -- LiveKit's own event id when it sends one; a locally generated uuid
        -- otherwise, so a retry of the same event does not duplicate rows.
        id              text primary key,
        event           text not null,
        room_name       text,
        participant_identity text,
        track_sid       text,
        -- LiveKit sends createdAt in Unix seconds. Kept as sent rather than
        -- converted, so the raw payload stays comparable with the server.
        created_at      bigint not null,
        egress_id       text,
        payload         jsonb not null default '{}'::jsonb,
        received_at     timestamptz not null default now()
      )
    `,
  },
  {
    id: '008_dashboard_webhook_events_created_idx',
    sql: `
      create index if not exists dashboard_webhook_events_created_idx
        on dashboard_webhook_events (created_at desc)
    `,
  },
  {
    id: '009_dashboard_webhook_events_room_idx',
    sql: `
      create index if not exists dashboard_webhook_events_room_idx
        on dashboard_webhook_events (room_name, created_at desc)
    `,
  },
  {
    id: '010_dashboard_webhook_events_event_idx',
    sql: `
      create index if not exists dashboard_webhook_events_event_idx
        on dashboard_webhook_events (event, created_at desc)
    `,
  },
  {
    id: '011_dashboard_metrics_snapshots',
    sql: `
      create table if not exists dashboard_metrics_snapshots (
        id                    bigserial primary key,
        recorded_at           timestamptz not null default now(),
        available             boolean not null,
        rooms_total           integer,
        rooms_avg_duration_s  double precision,
        participants_connected integer,
        participants_total    integer,
        packets_out           bigint,
        packets_dropped       bigint,
        packet_loss_ratio     double precision,
        quality_score_avg     double precision,
        quality_score_count   bigint,
        jitter_seconds        double precision,
        latency_ms_avg        double precision,
        cpu_seconds_total     double precision,
        resident_memory_bytes bigint,
        heap_inuse_bytes      bigint,
        open_fds              integer,
        goroutines            integer,
        network_rx_bytes      bigint,
        network_tx_bytes      bigint,
        webhooks_dispatched   bigint,
        webhooks_failed       bigint
      )
    `,
  },
  {
    id: '012_dashboard_metrics_snapshots_recorded_idx',
    sql: `
      create index if not exists dashboard_metrics_snapshots_recorded_idx
        on dashboard_metrics_snapshots (recorded_at desc)
    `,
  },
  {
    // Per-session idle window, so "remember me" actually changes how long a
    // session survives instead of the checkbox doing nothing.
    id: '013_dashboard_sessions_ttl_seconds',
    sql: `
      alter table dashboard_sessions
        add column if not exists ttl_seconds integer not null default 28800
    `,
  },
]

export async function migrate(sql: Sql): Promise<string[]> {
  await sql`
    create table if not exists dashboard_schema_migrations (
      id         text primary key,
      applied_at timestamptz not null default now()
    )
  `

  const applied = new Set(
    (await sql<{ id: string }[]>`select id from dashboard_schema_migrations`).map(
      (r) => r.id,
    ),
  )

  const ran: string[] = []
  for (const stmt of STATEMENTS) {
    if (applied.has(stmt.id)) continue
    // Each migration is its own transaction so a failure cannot leave a
    // half-applied statement recorded as done.
    await sql.begin(async (tx) => {
      await tx.unsafe(stmt.sql)
      await tx`insert into dashboard_schema_migrations (id) values (${stmt.id})`
    })
    ran.push(stmt.id)
  }
  return ran
}
