/**
 * The one database client. Import `db()` and `Tx` from here; never construct
 * another client.
 *
 * On Netlify, and under `npm run dev` without DATABASE_URL, it uses Netlify
 * Database through Drizzle's netlify-db adapter (NETLIFY_DB_URL). Locally and
 * in tests, DATABASE_URL points it at a plain Postgres instead. NETLIFY_DB_URL
 * always wins, so a stray DATABASE_URL can never redirect a deployed site.
 *
 * The client is created once per function instance, on first use, as
 * Netlify's docs ask (a client per request exhausts connections).
 */
import type { SQL } from 'drizzle-orm'
import { drizzle as netlifyDrizzle } from 'drizzle-orm/netlify-db'
import { drizzle as pgDrizzle } from 'drizzle-orm/node-postgres'
import type { PgAsyncDatabase, PgAsyncTransaction, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'

export type Db = PgAsyncDatabase<PgQueryResultHKT>
/** A transaction. Every chip-moving function takes one. */
export type Tx = PgAsyncTransaction<PgQueryResultHKT>
/** Either: for reads that can run inside or outside a transaction. */
export type Executor = Db | Tx

let instance: { db: Db; close: () => Promise<void> } | undefined

function connect(): { db: Db; close: () => Promise<void> } {
  if (process.env.NETLIFY_DB_URL) {
    const db = netlifyDrizzle()
    return {
      db: db as unknown as Db,
      close: async () => {
        const client = db.$client as { pool?: { end?: () => Promise<void> } }
        await client.pool?.end?.()
      },
    }
  }
  const url = process.env.DATABASE_URL
  if (url) {
    const pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    })
    return { db: pgDrizzle({ client: pool }) as unknown as Db, close: () => pool.end() }
  }
  throw new Error(
    'No database configured. On Netlify, NETLIFY_DB_URL is set automatically. ' +
      'Locally, set DATABASE_URL (see .env.example).',
  )
}

export function db(): Db {
  instance ??= connect()
  return instance.db
}

/** Tests only: closes the pool so the test database can be dropped. */
export async function closeDb(): Promise<void> {
  const current = instance
  instance = undefined
  await current?.close()
}

/**
 * Runs raw SQL and returns its rows. Prefer Drizzle's query builder; use this
 * for what it cannot express. Column values arrive as Postgres sends them:
 * bigint and numeric as strings, timestamps as ISO-like strings.
 */
export async function rows<T>(executor: Executor, query: SQL): Promise<T[]> {
  const result = (await executor.execute(query)) as unknown as { rows: T[] }
  return result.rows
}
