#!/usr/bin/env node
/**
 * Apply the dashboard schema. Safe to run repeatedly.
 *
 *   pnpm db:migrate
 *
 * Also used by `pnpm admin:create`, which needs the tables to exist.
 */

import { closeDb, getDb } from './index'
import { migrate } from './migrate'

// Loaded here rather than via a shell flag so `pnpm db:migrate` behaves the
// same on every platform. Next.js loads .env itself for the app; these
// scripts run outside Next and would otherwise see no DATABASE_URL.
try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: rely on the ambient environment (CI, container, Render).
}

async function main() {
  const sql = await getDb()
  const ran = await migrate(sql)
  if (ran.length === 0) {
    console.log('schema already up to date')
  } else {
    console.log(`applied ${ran.length} migration(s):`)
    for (const id of ran) console.log(`  + ${id}`)
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('migration failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
