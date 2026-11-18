/**
 * Integration tests: builds one template database with every migration
 * applied. Each test file then gets its own copy (tests/helpers/db.ts), so
 * files run in parallel without sharing data.
 */
import { loadDotEnv, migrate, recreate } from '../../scripts/db/local.ts'
import { templateUrl } from './db-names.ts'

export default async function setup() {
  loadDotEnv()
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error(
      'Integration tests need a local Postgres. Run npm run db:setup:local, ' +
        'or set TEST_DATABASE_URL (see .env.example).',
    )
  }
  const template = templateUrl(url)
  await recreate(template)
  await migrate(template)
}
