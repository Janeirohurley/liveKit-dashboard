/**
 * Server-only environment access.
 *
 * Every read goes through a getter that either returns a validated value or
 * throws with an actionable message. Nothing here may be imported from a
 * client component: `LIVEKIT_API_SECRET` and `DATABASE_URL` must never reach
 * the browser, so each export is annotated `server-only` by convention and
 * the secret is exposed only through the SDK clients in `lib/livekit`.
 */

/**
 * Missing or blank required variable.
 *
 * `name` is safe to surface in a server log and in the settings UI; the
 * VALUE is never part of this error.
 */
export class MissingConfigError extends Error {
  constructor(readonly name: string, readonly hint?: string) {
    super(
      `${name} is not set.${hint ? ` ${hint}` : ''} ` +
        `Copy .env.local.example to .env.local and fill it in.`,
    )
    this.name = 'MissingConfigError'
  }
}

function required(name: string, hint?: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new MissingConfigError(name, hint)
  return value
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim()
  return value || fallback
}

/**
 * LiveKit connection triple. The secret is deliberately NOT part of any type
 * that a client component can receive; it is consumed only by the server SDK
 * clients.
 */
export function liveKitConfig() {
  return {
    url: required(
      'LIVEKIT_URL',
      'The HTTP origin of livekit-server, e.g. http://localhost:7880.',
    ),
    apiKey: required('LIVEKIT_API_KEY', 'API key from `livekit-server --keys`.'),
    apiSecret: required(
      'LIVEKIT_API_SECRET',
      'API secret. Never sent to the browser.',
    ),
    region: optional('LIVEKIT_REGION', 'auto'),
  }
}

/** True when all three LiveKit variables are present; used by /api/health only. */
export function isLiveKitConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_URL?.trim() &&
      process.env.LIVEKIT_API_KEY?.trim() &&
      process.env.LIVEKIT_API_SECRET?.trim(),
  )
}

/** PostgreSQL DSN backing admin accounts, the audit log and the event store. */
export function databaseUrl(): string {
  return required(
    'DATABASE_URL',
    'PostgreSQL DSN, e.g. postgres://user:pass@localhost:5432/livekit_dashboard.',
  )
}

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

/**
 * HMAC key signing session cookies.
 *
 * Refuses to fall back to a default: a dashboard reachable with a guessed
 * signing key is an open admin panel. Generate with `openssl rand -hex 32`.
 */
export function sessionSecret(): string {
  const secret = required(
    'DASHBOARD_SESSION_SECRET',
    'Hex string of 32+ bytes used to sign session cookies. Generate with `openssl rand -hex 32`.',
  )
  if (secret.length < 32) {
    throw new Error(
      `DASHBOARD_SESSION_SECRET is too short (${secret.length} chars, need 32+). ` +
        'It signs admin sessions; regenerate with `openssl rand -hex 32`.',
    )
  }
  return secret
}

export function isAuthConfigured(): boolean {
  return (
    isDatabaseConfigured() && Boolean(process.env.DASHBOARD_SESSION_SECRET?.trim())
  )
}

/**
 * Prometheus scrape URL for livekit-server.
 *
 * `--prometheus-port` defaults to 0, so on a stock deployment no metrics
 * endpoint exists and the UI must say so rather than invent numbers.
 */
export function metricsUrl(): string | null {
  const explicit = process.env.LIVEKIT_METRICS_URL?.trim()
  if (explicit) return explicit
  return null
}
