/**
 * npm run db:reset:local
 *
 * Empties the local dev database and builds it again: every migration, then
 * the sample players and season (scripts/db/seed.ts). Use it after renaming a
 * migration (docs/LANE_GUIDE.md: Migration numbers) or to start clean. Your
 * local chats, rounds and wallets are lost. Refuses any database that is not
 * on this machine.
 */
import { closeDb } from '../../server/lib/db.ts'
import { loadDotEnv, migrate, recreate } from './local.ts'
import { seed } from './seed.ts'

loadDotEnv()
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Run npm run db:setup:local first (see .env.example).')
  process.exit(1)
}
await recreate(url)
const applied = await migrate(url)
const result = await seed()
await closeDb()
console.log(
  `Dev database rebuilt: ${applied.length} migrations, ${result.createdUsers.join(', ')} and a running season.`,
)
