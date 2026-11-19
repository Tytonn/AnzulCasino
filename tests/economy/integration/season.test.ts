/**
 * The end of a season against a real database (spec: Accounts and seasons >
 * Seasons): rank unlock posts, the final day, standings frozen once open
 * rounds are played out, the podium post and the Hall of Fame. All of it
 * moves on lazily, on the requests every browser makes, never on a timer.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CHIP } from '../../../shared/chips.ts'
import type { EconomyStateResponse } from '../../../shared/features/economy.ts'
import type { HallOfFame } from '../../../shared/features/season.ts'
import { economyApi } from '../../../server/features/economy/api.ts'
import { forgetMoments } from '../../../server/features/season/moments.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { credit, ledgerMismatches } from '../../../server/lib/wallet.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

let capture: { events: Outgoing[]; stop(): void }

beforeEach(async () => {
  capture = captureLive()
  forgetMoments()
  await testDb.query(`delete from rate_limits`)
})

afterEach(async () => {
  capture.stop()
  await testDb.query(`delete from config`)
})

const key = () => ({ 'idempotency-key': randomUUID() })

async function season(name: string, startsAgo: string, endsIn: string, status = 'active') {
  const [row] = await testDb.query<{ id: number }>(
    `insert into seasons (name, starts_at, ends_at, starting_balance, status)
     values ($1, now() - $2::interval, now() + $3::interval, 10000, $4) returning id`,
    [name, startsAgo, endsIn, status],
  )
  if (!row) throw new Error('no season')
  return row.id
}

async function seasonStatus(id: number): Promise<string> {
  const [row] = await testDb.query<{ status: string }>(`select status from seasons where id = $1`, [
    id,
  ])
  return row?.status ?? 'missing'
}

function posts(): string[] {
  return capture.events
    .filter((e) => e.name === 'chat.message')
    .map((e) => (e.envelope.data as { body: string }).body)
}

async function settle(clients: { settle(): Promise<unknown> }[]) {
  for (const c of clients) await c.settle()
}

describe('the season moving on', () => {
  it('announces each rank as it unlocks, once', async () => {
    const id = await season('Unlock season', '1 hour', '20 days')
    const playerId = await createPlayer(testDb)
    await fundWallet(id, playerId, 100n * CHIP)
    const client = await loggedIn(economyApi, playerId)

    await client.get('/api/economy/state')
    await client.settle()
    expect(posts()).toEqual([
      '🔓 Bronze rank is open: 150 chips for 15 a day in income. Buy it in the Shop.',
    ])

    // Silver brought forward to day 1 (an admin change): announced on the next look, Bronze not again.
    await testDb.query(
      `insert into config (key, value, effective_at) values ('tier_silver_unlock_day', '1', now() - interval '1 second')`,
    )
    forgetMoments()
    capture.events.length = 0
    await client.get('/api/economy/state')
    await client.get('/api/economy/state')
    await client.settle()
    expect(posts()).toEqual([
      '🔓 Silver rank is open: 1,000 chips for 100 a day in income. Buy it in the Shop.',
    ])

    // Over: end this season so the next tests have the clock to themselves.
    await testDb.query(
      `update seasons set ends_at = now() - interval '30 days', starts_at = now() - interval '40 days', status = 'ended' where id = $1`,
      [id],
    )
  })

  it('enters the final day on the first look in the last 24 hours, and posts it once', async () => {
    const id = await season('Final season', '5 days', '12 hours')
    const players = await Promise.all([0, 1].map(() => createPlayer(testDb)))
    for (const p of players) await fundWallet(id, p, 100n * CHIP)
    const [alice, bob] = await Promise.all(players.map((p) => loggedIn(economyApi, p)))
    if (!alice || !bob) throw new Error('no players')

    await alice.get('/api/economy/state')
    await bob.get('/api/economy/state')
    await settle([alice, bob])
    expect(await seasonStatus(id)).toBe('final_day')
    const finals = posts().filter((p) => p.startsWith('⏳'))
    expect(finals).toEqual([
      // The post goes up on the first look, 12 hours before the end, and says so.
      '⏳ The final day of Final season has begun: 12 hours to go. Steals, shields, vault moves and rank purchases are off now. The games stay open right to the end.',
    ])
    const state = capture.events.find((e) => e.name === 'season.state')
    expect(state?.envelope.data).toEqual({ seasonId: id, phase: 'final_day' })

    // Ranks are off; the buttons stay open.
    const buy = await alice.post('/api/economy/tier', { tier: 'bronze' }, key())
    expect(buy.status).toBe(409)
    expect(buy.body.error.message).toBe('Ranks cannot be bought on the final day.')
    expect((await alice.post('/api/economy/work', {}, key())).status).toBe(200)
  })

  it('freezes the standings once the open rounds are played out, and posts the podium', async () => {
    const [row] = await testDb.query<{ id: number }>(
      `select id from seasons where name = 'Final season'`,
    )
    const id = row?.id as number
    const names = ['Ava', 'Ben', 'Cal', 'Dee', 'Eve']
    const ids: string[] = []
    for (const name of names) {
      const user = await createPlayer(testDb, `${name.toLowerCase()}_${randomUUID().slice(0, 6)}`)
      await testDb.query(`update users set display_name = $2 where id = $1`, [user, name])
      ids.push(user)
    }
    const [ava, ben, cal, dee, eve] = ids as [string, string, string, string, string]
    await fundWallet(id, ava, 500n * CHIP)
    await fundWallet(id, ben, 800n * CHIP)
    // Cal ties Ben on net worth but got there later; part of it sits in the vault.
    await fundWallet(id, cal, 600n * CHIP)
    await db().transaction((tx) =>
      credit(tx, {
        seasonId: id,
        userId: cal,
        amount: 200n * CHIP,
        reason: 'vault_deposit',
        account: 'vault',
      }),
    )
    await fundWallet(id, dee, 50n * CHIP)
    // Eve is the richest, but her account is disabled.
    await fundWallet(id, eve, 9_000n * CHIP)
    await testDb.query(`update users set disabled_at = now() where id = $1`, [eve])

    // A hand dealt before the end is still open.
    await testDb.query(
      `insert into game_rounds (season_id, user_id, game, status, stake) values ($1, $2, 'blackjack', 'open', 100)`,
      [id, dee],
    )
    await testDb.query(`update seasons set ends_at = now() - interval '1 minute' where id = $1`, [
      id,
    ])
    const client = await loggedIn(economyApi, ava)

    const waiting = await client.get<HallOfFame>('/api/economy/hall-of-fame')
    expect(waiting.body.pending).toMatchObject({ id, name: 'Final season' })
    expect(await seasonStatus(id)).toBe('final_day')
    // After the end nothing moves chips.
    const work = await client.post('/api/economy/work', {}, key())
    expect(work.status).toBe(409)
    expect((await client.get<EconomyStateResponse>('/api/economy/state')).body.state).toBeNull()

    // The hand is played out: Dee wins 1,000 chips, which count.
    await db().transaction(async (tx) => {
      await tx.execute(
        `update game_rounds set status = 'settled', payout = 100000, multiplier = 1000, settled_at = now() where season_id = ${id} and status = 'open'` as never,
      )
      await credit(tx, { seasonId: id, userId: dee, amount: 1_000n * CHIP, reason: 'payout' })
    })
    forgetMoments()
    capture.events.length = 0
    const done = await client.get<HallOfFame>('/api/economy/hall-of-fame')
    await client.settle()
    expect(await seasonStatus(id)).toBe('ended')
    expect(done.body.pending).toBeNull()
    const record = done.body.seasons.find((s) => s.id === id)
    // The two players from the final-day test are in it too; Eve is not.
    expect(record?.places).toHaveLength(6)
    expect(record?.places.some((p) => p.userId === eve)).toBe(false)
    expect(record?.places.slice(0, 4).map((p) => [p.rank, p.displayName, p.netWorth])).toEqual([
      [1, 'Dee', 105_000],
      [2, 'Ben', 80_000],
      [3, 'Cal', 80_000],
      [4, 'Ava', 50_000],
    ])
    expect(posts()).toEqual([
      '🏁 Final season is over! 🥇 Dee 1,050 · 🥈 Ben 800 · 🥉 Cal 800. Every place is in the Hall of Fame.',
    ])
    const podium = capture.events.find((e) => e.name === 'chat.message')
    expect((podium?.envelope.data as { meta: unknown }).meta).toEqual({ tone: 'win', userId: dee })
    const over = capture.events.find((e) => e.name === 'season.state')
    expect(over?.envelope.data).toEqual({ seasonId: id, phase: 'over' })

    // Frozen standings never change, and the podium goes out once.
    await db().transaction((tx) =>
      credit(tx, { seasonId: id, userId: ava, amount: 10_000n * CHIP, reason: 'admin_adjust' }),
    )
    forgetMoments()
    capture.events.length = 0
    const later = await client.get<HallOfFame>('/api/economy/hall-of-fame')
    await client.settle()
    expect(later.body.seasons.find((s) => s.id === id)?.places[0]?.displayName).toBe('Dee')
    expect(posts()).toEqual([])
    expect(await ledgerMismatches(db(), id)).toEqual([])
  })

  it('stops waiting for an open round after round_timeout_minutes, and skips stale news', async () => {
    const id = await season('Old season', '60 days', '-50 days', 'final_day')
    const user = await createPlayer(testDb)
    await fundWallet(id, user, 100n * CHIP)
    await testDb.query(
      `insert into game_rounds (season_id, user_id, game, status, stake) values ($1, $2, 'crash', 'open', 100)`,
      [id, user],
    )
    const client = await loggedIn(economyApi, user)
    const res = await client.get<HallOfFame>('/api/economy/hall-of-fame')
    await client.settle()
    expect(await seasonStatus(id)).toBe('ended')
    expect(res.body.seasons.map((s) => s.name)).toEqual(['Final season', 'Old season'])
    expect(res.body.seasons[1]?.places).toHaveLength(1)
    // Its end is long past: the standings are frozen without a post.
    expect(posts()).toEqual([])
  })
})
