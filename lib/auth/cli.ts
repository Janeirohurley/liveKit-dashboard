#!/usr/bin/env node
/**
 * Create or update a dashboard admin. The only way to obtain credentials.
 *
 *   pnpm admin:create <email> [--name "Ops"] [--role admin|viewer]
 *
 * Reads the password from stdin rather than argv so it never lands in the
 * shell history or in `ps` output. Applying the schema first means this is the
 * only bootstrap step an operator needs.
 */

import { randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { closeDb, getDb } from '../db/index'
import { migrate } from '../db/migrate'
import { hashPassword, MIN_PASSWORD_LENGTH } from './password'

// See lib/db/cli.ts: these scripts run outside Next, which is what normally
// loads .env.
try {
  process.loadEnvFile('.env')
} catch {
  // No .env file: rely on the ambient environment.
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

function usage(message?: string): never {
  if (message) console.error(`error: ${message}\n`)
  console.error(
    'usage: pnpm admin:create <email> [--name "Display Name"] [--role admin|viewer]',
  )
  console.error(`       password is read from stdin (min ${MIN_PASSWORD_LENGTH} chars)`)
  process.exit(1)
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const answer = await rl.question(question)
    return answer
  } finally {
    rl.close()
  }
}

async function main() {
  const email = process.argv[2]
  if (!email || email.startsWith('--')) usage('an email is required')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage(`"${email}" is not a valid email`)

  const name = arg('--name') ?? email.split('@')[0]!
  const role = (arg('--role') ?? 'admin') as 'admin' | 'viewer'
  if (role !== 'admin' && role !== 'viewer') usage(`--role must be admin or viewer`)

  const password = (await prompt('password: ')).trim()
  if (password.length < MIN_PASSWORD_LENGTH) {
    usage(`password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  const confirm = (await prompt('confirm password: ')).trim()
  if (password !== confirm) usage('passwords do not match')

  const hash = await hashPassword(password)

  const sql = await getDb()
  await migrate(sql)

  const existing = await sql<{ id: string }[]>`
    select id from dashboard_admins where email = ${email.toLowerCase()}
  `

  let id: string
  if (existing[0]) {
    // Rotate the hash and bump token_version: every session issued under the
    // old password dies immediately.
    id = existing[0].id
    await sql.begin(async (tx) => {
      await tx`
        update dashboard_admins
           set password_hash = ${hash}, name = ${name}, role = ${role},
               token_version = token_version + 1, disabled_at = null
         where id = ${id}
      `
      await tx`
        update dashboard_sessions set revoked_at = now()
         where admin_id = ${id} and revoked_at is null
      `
    })
    console.log(`updated ${email} (id ${id}) — all existing sessions revoked`)
  } else {
    id = randomBytes(12).toString('base64url')
    await sql`
      insert into dashboard_admins (id, email, name, password_hash, role)
      values (${id}, ${email.toLowerCase()}, ${name}, ${hash}, ${role})
    `
    console.log(`created ${email} as ${role} (id ${id})`)
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
