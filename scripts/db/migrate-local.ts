/**
 * npm run db:migrate:local
 *
 * Applies pending migrations to the local dev database in DATABASE_URL.
 * `npm run dev` does this on start too, so this is mostly for scripts.
 */
import { loadDotEnv, migrate } from './local.ts'

loadDotEnv()
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set. Run npm run db:setup:local first (see .env.example).')
  process.exit(1)
}
const applied = await migrate(url)
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Already up to date.')
