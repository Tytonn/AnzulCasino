/**
 * Quick test data: players, an active season, funded wallets and logged-in
 * API clients, written straight to the test database. Tests of the real
 * flows (signup, starting a season) go through the endpoints instead.
 *
 * Call useTestDatabase() first, so the server code points at the test copy.
 */
import { randomBytes } from 'node:crypto'

import { wallets } from '../../db/schema/core.ts'
import { createSession, SESSION_COOKIE } from '../../server/lib/auth.ts'
import { db } from '../../server/lib/db.ts'
import { credit } from '../../server/lib/wallet.ts'
import { type ApiClient, apiClient, type ApiClientOptions } from './api.ts'
import type { TestDatabase } from './db.ts'

type Handler = Parameters<typeof apiClient>[0]

function first<T>(rows: T[]): T {
  const [row] = rows
  if (row === undefined) throw new Error('Expected a row')
  return row
}

export async function createPlayer(
  testDb: TestDatabase,
  username = `p_${randomBytes(5).toString('hex')}`,
): Promise<string> {
  const row = first(
    await testDb.query<{ id: string }>(
      `insert into users (username, password_hash, display_name)
       values ($1, 'not-a-real-hash', $1) returning id`,
      [username],
    ),
  )
  return row.id
}

/** An active season that started a day ago and ends in 29 days. */
export async function createSeason(
  testDb: TestDatabase,
  startingBalance = 10_000n,
): Promise<number> {
  const row = first(
    await testDb.query<{ id: number }>(
      `insert into seasons (name, starts_at, ends_at, starting_balance, status)
       values ('Test season', now() - interval '1 day', now() + interval '29 days', $1, 'active')
       returning id`,
      [String(startingBalance)],
    ),
  )
  return row.id
}

/** Opens the player's wallet for the season and credits `amount` (hundredths). */
export async function fundWallet(seasonId: number, userId: string, amount: bigint): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.insert(wallets).values({ seasonId, userId }).onConflictDoNothing()
    if (amount > 0n) await credit(tx, { seasonId, userId, amount, reason: 'season_start' })
  })
}

/** An API client already logged in as the player. */
export async function loggedIn(
  handler: Handler,
  userId: string,
  options?: ApiClientOptions,
): Promise<ApiClient> {
  const client = apiClient(handler, options)
  client.cookies.set(SESSION_COOKIE, await createSession(db(), userId))
  return client
}
