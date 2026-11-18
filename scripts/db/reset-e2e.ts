/**
 * Runs before the browser-test server starts (npm run e2e:serve): gives the
 * browser tests a fresh database with every migration applied.
 */
import { loadDotEnv, migrate, recreate } from './local.ts'

loadDotEnv()
const url = process.env.E2E_DATABASE_URL
if (!url) {
  console.error('E2E_DATABASE_URL is not set (see .env.example).')
  process.exit(1)
}
await recreate(url)
const applied = await migrate(url)
console.log(`Browser-test database ready (${applied.length} migrations).`)
