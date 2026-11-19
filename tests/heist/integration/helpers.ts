/**
 * Shared setup for the heist lane's endpoint tests: a fresh season per test
 * (so the leaderboard holds only that test's players), players with a given
 * number of chips, config values that take effect at once, and short names
 * for the requests.
 */
import { randomUUID } from 'node:crypto'

import { CHIP } from '../../../shared/chips.ts'
import type { ConfigKey } from '../../../shared/config.ts'
import { heistApi } from '../../../server/features/heist/api.ts'
import { db } from '../../../server/lib/db.ts'
import { readWallet } from '../../../server/lib/wallet.ts'
import type { ApiClient } from '../../helpers/api.ts'
import type { TestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

export const key = () => ({ 'idempotency-key': randomUUID() })

export interface TestPlayer {
  id: string
  name: string
  client: ApiClient
}

export function heistFixtures(testDb: TestDatabase) {
  let seasonId = 0

  return {
    get seasonId() {
      return seasonId
    },

    /**
     * A new season that started a day ago, ends in 29 days, and is the one
     * running (it started last). `endsInHours` puts it in its final day.
     */
    async freshSeason(endsInHours?: number): Promise<number> {
      // Each one starts a moment after the last (now() moves on), so it is the one running.
      seasonId = await createSeason(testDb)
      if (endsInHours !== undefined) {
        await testDb.query(
          `update seasons set ends_at = now() + make_interval(hours => $2) where id = $1`,
          [seasonId, endsInHours],
        )
      }
      return seasonId
    },

    /** A player with `whole` chips in this season's wallet. */
    async player(whole: number | bigint, name?: string): Promise<TestPlayer> {
      const id = await createPlayer(testDb, name)
      await fundWallet(seasonId, id, BigInt(whole) * CHIP)
      const [row] = await testDb.query<{ display_name: string }>(
        `select display_name from users where id = $1`,
        [id],
      )
      return { id, name: row?.display_name ?? '', client: await loggedIn(heistApi, id) }
    },

    /** Sets a config value that takes effect at once (steal settings normally wait for the reset). */
    async setConfig(name: ConfigKey, value: number): Promise<void> {
      await testDb.query(`delete from config where key = $1`, [name])
      await testDb.query(
        `insert into config (key, value, effective_at) values ($1, $2::jsonb, now() - interval '1 second')`,
        [name, JSON.stringify(value)],
      )
    },

    async clearConfig(): Promise<void> {
      await testDb.query(`delete from config`)
    },

    async wallet(userId: string): Promise<{ balance: bigint; vault: bigint }> {
      const found = await readWallet(db(), seasonId, userId)
      if (!found) throw new Error('no wallet')
      return { balance: found.balance, vault: found.vault }
    },

    /** Moves all of a player's ledger rows (and so their net worth) to before today's reset. */
    async backdate(userId: string): Promise<void> {
      await testDb.query(
        `update ledger set created_at = now() - interval '2 days' where user_id = $1 and season_id = $2`,
        [userId, seasonId],
      )
    },
  }
}
