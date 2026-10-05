import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

/** Minimal .env reader so the e2e run reuses the developer's real credentials. */
function readDotEnv(dir: string): Record<string, string> {
  const file = join(dir, '.env')
  if (!existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Credentials are only injected for e2e runs. `LIVEKIT_E2E=1` exercises the
 * adapter against a real LiveKit server and `DB_E2E=1` exercises the event
 * store against a real Postgres; both read the developer's `.env` rather than
 * placeholders. Without them the suite runs fully offline.
 */
const liveKitE2e = process.env.LIVEKIT_E2E === '1'
const dbE2e = process.env.DB_E2E === '1'
const e2e = liveKitE2e || dbE2e
const root = fileURLToPath(new URL('./', import.meta.url))
const localEnv = e2e ? readDotEnv(root) : {}

// Placeholders only. The keys match lib/env.ts exactly; the DB suite skips
// itself when the DSN does not resolve, so nothing here needs a live database.
const offlineEnv = {
  DASHBOARD_SESSION_SECRET: 'a'.repeat(64),
  DATABASE_URL: '',
  LIVEKIT_URL: 'http://127.0.0.1:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecretdevsecretdevsecretdevsecr',
  LIVEKIT_METRICS_URL: '',
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['**/node_modules/**', '**/.git/**', '**/.next/**'],
    env: e2e ? localEnv : offlineEnv,
  },
  resolve: {
    alias: {
      '@': root,
    },
  },
})
