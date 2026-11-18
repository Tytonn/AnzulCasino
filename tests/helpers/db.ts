/**
 * Gives the calling test file its own database, copied from the migrated
 * template, and points the server code at it through DATABASE_URL.
 *
 *   const db = await useTestDatabase()
 *
 * Call it at the top level of a test file, before importing server code that
 * reads the database.
 */
import { randomBytes } from 'node:crypto'

import pg from 'pg'
import { afterAll } from 'vitest'

import { databaseName, drop, loadDotEnv, recreate, withDatabase } from '../../scripts/db/local.ts'
import { templateUrl } from './db-names.ts'

export interface TestDatabase {
  url: string
  /** A plain pg client for assertions that bypass the app's code. */
  query<T extends pg.QueryResultRow = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>
}

export async function useTestDatabase(): Promise<TestDatabase> {
  loadDotEnv()
  const base = process.env.TEST_DATABASE_URL
  if (!base) throw new Error('TEST_DATABASE_URL is not set (see .env.example).')
  const template = databaseName(templateUrl(base))
  const url = withDatabase(
    base,
    `${template.replace(/_template$/, '')}_${randomBytes(4).toString('hex')}`,
  )
  await recreate(url, template)
  process.env.DATABASE_URL = url

  const pool = new pg.Pool({ connectionString: url, max: 2 })
  afterAll(async () => {
    await pool.end()
    await drop(url)
  })

  return {
    url,
    async query(sql, params) {
      const result = await pool.query(sql, params)
      return result.rows
    },
  }
}
