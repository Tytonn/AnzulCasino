/**
 * Helpers for local Postgres databases: dev, tests and browser tests.
 *
 * Migrations are applied with the same code Netlify's local tools use
 * (@netlify/database-dev), so ordering and tracking match what Netlify does
 * on a deploy. Every helper refuses a database that is not on this machine:
 * hosted databases only ever get migrations from Netlify's deploys.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { applyMigrations, initializeTrackingTable, type SQLExecutor } from '@netlify/database-dev'
import pg from 'pg'

export const MIGRATIONS_DIR = resolve(import.meta.dirname, '../../netlify/database/migrations')

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', ''])

export function assertLocalUrl(url: string): URL {
  const parsed = new URL(url)
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Refusing to touch ${parsed.hostname}: these scripts only work on a local database. ` +
        'Netlify applies migrations to hosted databases on deploy.',
    )
  }
  return parsed
}

export function databaseName(url: string): string {
  const name = assertLocalUrl(url).pathname.replace(/^\//, '')
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unexpected database name "${name}"`)
  return name
}

/** The same server, a different database. */
export function withDatabase(url: string, name: string): string {
  const parsed = assertLocalUrl(url)
  parsed.pathname = `/${name}`
  return parsed.toString()
}

function executor(client: pg.Client): SQLExecutor {
  const exec = async (sql: string) => client.query(sql)
  const query = async <T>(sql: string, params?: unknown[]) => {
    const result = await client.query(sql, params)
    return { rows: result.rows as T[] }
  }
  return {
    exec,
    query,
    async transaction(fn) {
      await client.query('BEGIN')
      try {
        const result = await fn({ exec, query })
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    },
  }
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  assertLocalUrl(url)
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** Applies every pending migration. Returns the names it applied. */
export async function migrate(url: string): Promise<string[]> {
  return withClient(url, async (client) => {
    if (existsSync(MIGRATIONS_DIR)) return applyMigrations(executor(client), MIGRATIONS_DIR)
    await initializeTrackingTable(executor(client))
    return []
  })
}

/** Drops the database if it exists and creates it empty. */
export async function recreate(url: string, template?: string): Promise<void> {
  const name = databaseName(url)
  if (template !== undefined && !/^[a-z0-9_]+$/.test(template)) {
    throw new Error(`Unexpected template name "${template}"`)
  }
  await withClient(withDatabase(url, 'postgres'), async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await client.query(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ''}`)
  })
}

export async function drop(url: string): Promise<void> {
  const name = databaseName(url)
  await withClient(withDatabase(url, 'postgres'), async (client) => {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
  })
}

/** Loads .env into process.env without overriding what is already set. */
export function loadDotEnv(): void {
  const file = resolve(import.meta.dirname, '../../.env')
  if (existsSync(file)) process.loadEnvFile(file)
}
