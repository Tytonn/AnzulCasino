/**
 * npm run db:seed:local
 *
 * Fills the local dev database with an admin, three players and a running
 * season (scripts/db/seed.ts). Safe to run twice. Refuses any database that
 * is not on this machine.
 */
import { closeDb } from '../../server/lib/db.ts'
import { assertLocalUrl, loadDotEnv, migrate } from './local.ts'
import { SEED_PASSWORD, SEED_PLAYERS, seed } from './seed.ts'

loadDotEnv()
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Run npm run db:setup:local first (see .env.example).')
  process.exit(1)
}
assertLocalUrl(url)
await migrate(url)

const result = await seed()
await closeDb()

console.log(
  result.createdUsers.length
    ? `Created ${result.createdUsers.join(', ')}.`
    : 'The sample players were already there.',
)
console.log(
  result.season.created
    ? `Started "${result.season.name}" with everyone's starting balance.`
    : `"${result.season.name}" is already running.`,
)
console.log(
  `Log in as ${SEED_PLAYERS.map((p) => p.username).join(', ')} with the password ${SEED_PASSWORD}.`,
)
