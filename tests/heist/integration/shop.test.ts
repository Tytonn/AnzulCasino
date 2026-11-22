/**
 * What the heist lane sells, and the vault, against a real database (spec:
 * Shields, Vault, Shop): prices come out of the wallet as one ledger row,
 * the limits hold under replays and parallel clicks, and nothing is sold in
 * the season's final day.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CHIP } from '../../../shared/chips.ts'
import type {
  ExtraAttemptResponse,
  HeistState,
  ShieldResponse,
  VaultResponse,
} from '../../../shared/features/heist.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { standings } from '../../../server/lib/seasons.ts'
import { ledgerMismatches } from '../../../server/lib/wallet.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { heistFixtures, key, type TestPlayer } from './helpers.ts'

process.env.DATABASE_POOL_MAX = '20'
const testDb = await useTestDatabase()
const fx = heistFixtures(testDb)

type Refusal = { error: { code: string; message: string } }

let capture: { events: Outgoing[]; stop(): void }

beforeEach(async () => {
  capture = captureLive()
  await testDb.query(`delete from rate_limits`)
  await fx.clearConfig()
  await fx.freshSeason()
})

afterEach(() => {
  capture.stop()
})

function buyShield(player: TestPlayer, headers = key()) {
  return player.client.post<ShieldResponse & Refusal>('/api/heist/shield', {}, headers)
}

function buyExtra(player: TestPlayer, headers = key()) {
  return player.client.post<ExtraAttemptResponse & Refusal>('/api/heist/extra-attempt', {}, headers)
}

function vault(player: TestPlayer, direction: string, amount: string, headers = key()) {
  return player.client.post<VaultResponse & Refusal>(
    '/api/heist/vault',
    { direction, amount },
    headers,
  )
}

async function state(player: TestPlayer) {
  const res = await player.client.get<HeistState>('/api/heist/state')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

async function ledger(userId: string, reason: string) {
  return testDb.query<{ account: string; delta: string; ref_type: string | null }>(
    `select account, delta, ref_type from ledger
      where season_id = $1 and user_id = $2 and reason = $3 order by id`,
    [fx.seasonId, userId, reason],
  )
}

async function expectLedgerClean() {
  expect(await ledgerMismatches(db(), fx.seasonId)).toEqual([])
}

/** Moves the player's daily row to yesterday, as if the 4:00 AM reset had passed. */
async function nextGameDay(userId: string) {
  await testDb.query(
    `update daily_state set game_day = game_day - 1 where season_id = $1 and user_id = $2`,
    [fx.seasonId, userId],
  )
}

describe('POST /api/heist/shield', () => {
  it('costs 2% of the wallet, removed from the game, for one charge', async () => {
    const player = await fx.player(10_000)
    const res = await buyShield(player)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ charges: 1, price: 200, shieldsThisWeek: 1 })
    expect(res.body.wallet).toMatchObject({ seasonId: fx.seasonId, balance: 9_800, vault: 0 })
    expect(await fx.wallet(player.id)).toEqual({ balance: 9_800n, vault: 0n })
    expect(await ledger(player.id, 'shield_purchase')).toEqual([
      { account: 'wallet', delta: '-200', ref_type: 'shield_purchase' },
    ])
    const purchases = await testDb.query<{ price: string }>(
      `select price from shield_purchases where season_id = $1 and user_id = $2`,
      [fx.seasonId, player.id],
    )
    expect(purchases).toEqual([{ price: '200' }])
    expect((await state(player)).me).toMatchObject({ charges: 1, shieldsThisWeek: 1 })
    await expectLedgerClean()
  })

  it('costs at least 30 chips', async () => {
    // 2% of 1,499 is 29.98, rounded down to 29: the 30-chip floor applies.
    const player = await fx.player(1_499)
    const res = await buyShield(player)
    expect(res.status).toBe(200)
    expect(res.body.price).toBe(30)
    expect(await fx.wallet(player.id)).toEqual({ balance: 1_469n, vault: 0n })
  })

  it('refuses a player who cannot pay, and charges nothing', async () => {
    const player = await fx.player(20)
    const res = await buyShield(player)
    expect(res.status).toBe(400)
    expect(res.body.error).toEqual({
      code: 'insufficient_funds',
      message: 'A shield charge costs 30 chips and you have 20 chips.',
    })
    expect(await fx.wallet(player.id)).toEqual({ balance: 20n, vault: 0n })
    expect((await state(player)).me.charges).toBe(0)
  })

  it('holds at most two charges', async () => {
    const player = await fx.player(1_000)
    expect((await buyShield(player)).status).toBe(200)
    expect((await buyShield(player)).status).toBe(200)
    const third = await buyShield(player)
    expect(third.status).toBe(409)
    expect(third.body.error).toEqual({
      code: 'shield_max',
      message: 'You already hold 2 shield charges, the most you can hold.',
    })
    expect(await ledger(player.id, 'shield_purchase')).toHaveLength(2)
  })

  it('sells at most three a season week, and more when the next week starts', async () => {
    await fx.setConfig('shield_max_charges', 5)
    const player = await fx.player(1_000)
    for (let i = 0; i < 3; i++) expect((await buyShield(player)).status).toBe(200)
    const fourth = await buyShield(player)
    expect(fourth.status).toBe(409)
    expect(fourth.body.error.code).toBe('shield_week')
    expect(fourth.body.error.message).toMatch(/bought 3 shield charges this season week/)

    // A week later: the season started eight days ago and the purchases were last week.
    await testDb.query(`update seasons set ends_at = now() - interval '1 minute' where id <> $1`, [
      fx.seasonId,
    ])
    await testDb.query(`update seasons set starts_at = now() - interval '8 days' where id = $1`, [
      fx.seasonId,
    ])
    await testDb.query(
      `update shield_purchases set created_at = now() - interval '3 days' where season_id = $1`,
      [fx.seasonId],
    )
    const nextWeek = await buyShield(player)
    expect(nextWeek.status, JSON.stringify(nextWeek.body)).toBe(200)
    expect(nextWeek.body).toMatchObject({ charges: 4, shieldsThisWeek: 1 })
    const seen = await state(player)
    expect(seen.me.shieldsThisWeek).toBe(1)
    expect(Date.parse(seen.me.weekEndsAt ?? '')).toBeGreaterThan(Date.now())
  })

  it('replays a repeated request key without charging twice', async () => {
    const player = await fx.player(1_000)
    const headers = key()
    const first = await buyShield(player, headers)
    const again = await buyShield(player, headers)
    expect(first.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(await ledger(player.id, 'shield_purchase')).toHaveLength(1)
  })

  it('never sells past the limit to parallel clicks', async () => {
    const player = await fx.player(1_000)
    const results = await Promise.all(Array.from({ length: 6 }, () => buyShield(player)))
    expect(results.filter((r) => r.status === 200)).toHaveLength(2)
    expect(results.filter((r) => r.status === 409)).toHaveLength(4)
    expect((await state(player)).me.charges).toBe(2)
    expect(await ledger(player.id, 'shield_purchase')).toHaveLength(2)
    await expectLedgerClean()
  })

  it('tells only the buyer, and is closed in the final day', async () => {
    const player = await fx.player(1_000)
    expect((await buyShield(player)).status).toBe(200)
    await player.client.settle()
    const heist = capture.events.filter((e) => e.name === 'heist.changed')
    expect(heist.map((e) => e.channel)).toEqual([`user:${player.id}`])
    expect(capture.events.some((e) => e.channel === 'chat')).toBe(false)

    await fx.freshSeason(6)
    const late = await fx.player(1_000)
    const res = await buyShield(late)
    expect(res.status).toBe(409)
    expect(res.body.error).toEqual({
      code: 'final_day',
      message: 'Shields are closed for the final 24 hours of the season.',
    })
  })
})

describe('POST /api/heist/extra-attempt', () => {
  it('sells one extra steal attempt a game day at its price', async () => {
    const player = await fx.player(10_000)
    const res = await buyExtra(player)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ attemptsAllowed: 3, price: 200 })
    expect(await fx.wallet(player.id)).toEqual({ balance: 9_800n, vault: 0n })
    expect(await ledger(player.id, 'steal_attempt_purchase')).toEqual([
      { account: 'wallet', delta: '-200', ref_type: 'game_day' },
    ])
    expect((await state(player)).me).toMatchObject({ attemptsAllowed: 3, extraBought: true })

    const again = await buyExtra(player)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('extra_bought')

    await nextGameDay(player.id)
    expect((await buyExtra(player)).status).toBe(200)
    await expectLedgerClean()
  })

  it('costs at least 30 chips, and refuses a player who cannot pay', async () => {
    const cheap = await fx.player(500)
    expect((await buyExtra(cheap)).body.price).toBe(30)
    const broke = await fx.player(1)
    const res = await buyExtra(broke)
    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('The extra attempt costs 30 chips and you have 1 chip.')
  })

  it('sells one to parallel clicks and replays a repeated key', async () => {
    const player = await fx.player(1_000)
    const headers = key()
    const results = await Promise.all([
      buyExtra(player, headers),
      buyExtra(player),
      buyExtra(player),
      buyExtra(player),
    ])
    expect(results.filter((r) => r.status === 200).length).toBe(1)
    expect(await ledger(player.id, 'steal_attempt_purchase')).toHaveLength(1)
    const replay = await buyExtra(player, headers)
    expect(replay.status).toBe(results[0]?.status)
  })

  it('is closed in the final day', async () => {
    await fx.freshSeason(20)
    const player = await fx.player(1_000)
    const res = await buyExtra(player)
    expect(res.status).toBe(409)
    expect(res.body.error.message).toBe('Steals are closed for the final 24 hours of the season.')
  })
})

describe('POST /api/heist/vault', () => {
  it('moves chips from the wallet into the vault as two ledger rows', async () => {
    const player = await fx.player(1_000)
    const res = await vault(player, 'deposit', '200')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body).toMatchObject({ direction: 'deposit', amount: 200 })
    expect(res.body.wallet).toMatchObject({ balance: 800, vault: 200 })
    expect(await fx.wallet(player.id)).toEqual({ balance: 800n, vault: 200n })
    expect(await ledger(player.id, 'vault_deposit')).toEqual([
      { account: 'wallet', delta: '-200', ref_type: 'game_day' },
      { account: 'vault', delta: '200', ref_type: 'game_day' },
    ])
    expect((await state(player)).me.vaultMoved).toBe(true)
    await expectLedgerClean()
  })

  it('holds at most a quarter of net worth, and `max` fills it exactly', async () => {
    const player = await fx.player(1_000)
    const over = await vault(player, 'deposit', '300')
    expect(over.status).toBe(409)
    expect(over.body.error).toEqual({
      code: 'vault_full',
      message: 'Your vault can take 250 chips more right now: up to 25% of your net worth.',
    })
    const max = await vault(player, 'deposit', 'max')
    expect(max.status).toBe(200)
    expect(max.body.amount).toBe(250)

    await nextGameDay(player.id)
    const full = await vault(player, 'deposit', 'max')
    expect(full.status).toBe(409)
    expect(full.body.error.message).toBe(
      'Your vault is full: it can hold up to 25% of your net worth.',
    )
  })

  it('reads `half` as half of what the move allows', async () => {
    const player = await fx.player(1_000)
    expect((await vault(player, 'deposit', 'half')).body.amount).toBe(125)
    await nextGameDay(player.id)
    // Half of 125 is 62.5: rounded down to a whole chip.
    expect((await vault(player, 'withdraw', 'half')).body.amount).toBe(62)
    expect(await fx.wallet(player.id)).toEqual({ balance: 937n, vault: 63n })
  })

  it('allows one move a game day, deposit or withdrawal', async () => {
    const player = await fx.player(1_000)
    expect((await vault(player, 'deposit', '100')).status).toBe(200)
    const again = await vault(player, 'withdraw', '50')
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('vault_moved')
    expect(again.body.error.message).toMatch(/next move opens at 4:00 AM Central/)

    await nextGameDay(player.id)
    const out = await vault(player, 'withdraw', 'all')
    expect(out.status, JSON.stringify(out.body)).toBe(200)
    expect(out.body).toMatchObject({ direction: 'withdraw', amount: 100 })
    expect(await fx.wallet(player.id)).toEqual({ balance: 1_000n, vault: 0n })
    expect(await ledger(player.id, 'vault_withdraw')).toEqual([
      { account: 'vault', delta: '-100', ref_type: 'game_day' },
      { account: 'wallet', delta: '100', ref_type: 'game_day' },
    ])
    await expectLedgerClean()
  })

  it('explains an empty vault, an empty wallet, a bad amount and too much', async () => {
    const player = await fx.player(1_000)
    const empty = await vault(player, 'withdraw', 'all')
    expect(empty.status).toBe(400)
    expect(empty.body.error).toEqual({ code: 'vault_empty', message: 'Your vault is empty.' })

    const tooMuch = await vault(player, 'withdraw', '5')
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error.message).toBe('Your vault is empty.')

    const words = await vault(player, 'deposit', 'lots')
    expect(words.status).toBe(400)
    expect(words.body.error.message).toBe('"lots" is not an amount. Try 20, half or max.')

    const zero = await vault(player, 'deposit', '0')
    expect(zero.status).toBe(400)
    expect(zero.body.error.message).toBe('Type at least 1 chip.')

    const more = await vault(player, 'deposit', '2000')
    expect(more.status).toBe(400)
    expect(more.body.error).toEqual({
      code: 'insufficient_funds',
      message: 'You only have 1,000 chips in your wallet.',
    })

    const broke = await fx.player(0)
    const nothing = await vault(broke, 'deposit', 'max')
    expect(nothing.status).toBe(400)
    expect(nothing.body.error.code).toBe('wallet_empty')

    // None of the refusals used the day's move.
    expect((await state(player)).me.vaultMoved).toBe(false)
    expect((await vault(player, 'deposit', '10')).status).toBe(200)
  })

  it('makes one move from parallel clicks and replays a repeated key', async () => {
    const player = await fx.player(1_000)
    const headers = key()
    const results = await Promise.all([
      vault(player, 'deposit', '100', headers),
      vault(player, 'deposit', '100'),
      vault(player, 'deposit', '100'),
    ])
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await fx.wallet(player.id)).toEqual({ balance: 900n, vault: 100n })
    const replay = await vault(player, 'deposit', '100', headers)
    expect(replay.status).toBe(results[0]?.status)
    expect(await fx.wallet(player.id)).toEqual({ balance: 900n, vault: 100n })
    await expectLedgerClean()
  })

  it('keeps the vault in net worth, so a deposit does not move the leaderboard', async () => {
    const player = await fx.player(1_000)
    const other = await fx.player(900)
    expect((await vault(player, 'deposit', 'max')).status).toBe(200)
    // 750 in the wallet is less than the other player's 900, but 1,000 of net worth still leads.
    const board = await standings(db(), fx.seasonId)
    expect(board.map((s) => [s.userId, s.rank, s.netWorth])).toEqual([
      [player.id, 1, 1_000n * CHIP],
      [other.id, 2, 900n * CHIP],
    ])
  })

  it('is closed in the final day', async () => {
    await fx.freshSeason(1)
    const player = await fx.player(1_000)
    const res = await vault(player, 'deposit', '10')
    expect(res.status).toBe(409)
    expect(res.body.error).toEqual({
      code: 'final_day',
      message: 'Vault moves are closed for the final 24 hours of the season.',
    })
  })
})
