/**
 * Append-only audit trail for administrative actions.
 *
 * The spec requires destructive operations to be auditable, so every
 * room/participant/track mutation and every authentication decision lands
 * here. Two rules matter:
 *
 *   1. It never fails an operation. If Postgres is unreachable the action
 *      still completed; failing it afterwards would be worse than the gap, so
 *      the error is logged and swallowed.
 *   2. It redacts. Keys that look like secrets are replaced before write, so a
 *      future caller cannot leak a token by passing an options object through.
 */

import { getDb } from '@/lib/db'

const REDACTED = '[redacted]'

/** Substrings that mark a field as sensitive, matched case-insensitively. */
const SENSITIVE_KEY = /(secret|password|token|authorization|cookie|apikey|api_key|credential|bearer)/i

export interface AuditEntry {
  adminId: string | null
  adminEmail: string
  action: string
  targetType?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ok?: boolean
  ip?: string | null
}

/**
 * Recursively replace sensitive values, and clamp depth/length so a large
 * object cannot bloat the table.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth-limit]'
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(val, depth + 1)
    }
    return out
  }
  return String(value)
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const sql = await getDb()
    const metadata = (redact(entry.metadata ?? {}) ?? {}) as Parameters<
      (typeof sql)['json']
    >[0]
    await sql`
      insert into dashboard_audit_log
        (admin_id, admin_email, action, target_type, target_id, metadata, ok, ip)
      values
        (${entry.adminId}, ${entry.adminEmail}, ${entry.action},
         ${entry.targetType ?? null}, ${entry.targetId ?? null},
         ${sql.json(metadata)}, ${entry.ok ?? true}, ${entry.ip ?? null})
    `
  } catch (error) {
    console.error(
      '[audit] write failed for',
      entry.action,
      '-',
      error instanceof Error ? error.message : error,
    )
  }
}

export interface AuditRecord {
  id: string
  adminEmail: string
  action: string
  targetType: string | null
  targetId: string | null
  metadata: Record<string, unknown>
  ok: boolean
  ip: string | null
  createdAt: string
}

export interface AuditQuery {
  limit?: number
  action?: string
  before?: string
}

export async function listAudit(query: AuditQuery = {}): Promise<AuditRecord[]> {
  const sql = await getDb()
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
  const rows = await sql`
    select id, admin_email, action, target_type, target_id, metadata, ok, ip, created_at
      from dashboard_audit_log
     where (${query.action ?? null}::text is null or action = ${query.action ?? null})
       and (${query.before ?? null}::timestamptz is null or created_at < ${query.before ?? null})
     order by created_at desc, id desc
     limit ${limit}
  `
  return rows.map((r) => ({
    id: String(r.id),
    adminEmail: r.admin_email,
    action: r.action,
    targetType: r.target_type ?? null,
    targetId: r.target_id ?? null,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    ok: Boolean(r.ok),
    ip: r.ip ?? null,
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }))
}
