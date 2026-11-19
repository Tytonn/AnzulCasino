/**
 * The economy's endpoints against a real database (spec: Economy, and the
 * Quality bar): work, slut and crime, rank income and the streak, ranks,
 * challenges and chat drops. Every chip moves through the ledger, a replayed
 * request changes nothing, parallel requests cannot double-spend or
 * double-claim, nothing hidden leaves the server, and every endpoint wants a
 * session and valid input.
 */
import { randomUUID } from 'node:crypto'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { CHIP } from '../../../shared/chips.ts'
import type {
  ChallengeClaimResponse,
  CollectResponse,
  DropClaimResponse,
  EconomyStateResponse,
  IncomeResponse,
  SavedChallenge,
  TierResponse,
} from '../../../shared/features/economy.ts'
import { FULL_LINE_POOLS } from '../../../shared/features/economy-lines.ts'
import { addGameDays, gameDay } from '../../../shared/game-day.ts'
import { economyApi } from '../../../server/features/economy/api.ts'
import { forgetMoments } from '../../../server/features/season/moments.ts'
import { db, dbNow } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { ledgerMismatches, readWallet } from '../../../server/lib/wallet.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

process.env.DATABASE_POOL_MAX = '30'
const testDb = await useTestDatabase()

let seasonId: number
let capture: { events: Outgoing[]; stop(): void }

beforeAll(async () => {
  seasonId = await createSeason(testDb)
})

beforeEach(async () => {
  capture = captureLive()
  forgetMoments()
  await testDb.query(`delete from rate_limits`)
})

afterEach(async () => {
  capture.stop()
  await testDb.query(`delete from config`)
})

afterAll(async () => {
  expect(await ledgerMismatches(db(), seasonId)).toEqual([])
})

const key = () => ({ 'idempotency-key': randomUUID() })

async function player(whole: bigint, options: { joinedDaysAgo?: number } = {}) {
  const id = await createPlayer(testDb)
  if (options.joinedDaysAgo) {
    await testDb.query(
      `update users set created_at = now() - make_interval(days => $2) where id = $1`,
      [id, options.joinedDaysAgo],
    )
  }
  await fundWallet(seasonId, id, whole * CHIP)
  return { id, client: await loggedIn(economyApi, id) }
}

async function balance(userId: string): Promise<bigint> {
  const wallet = await readWallet(db(), seasonId, userId)
  if (!wallet) throw new Error('no wallet')
  return wallet.balance
}

/** Sets a config value from now on (economy changes normally wait for the reset). */
async function setConfig(name: string, value: unknown) {
  await testDb.query(
    `insert into config (key, value, effective_at) values ($1, $2::jsonb, now() - interval '1 second')`,
    [name, JSON.stringify(value)],
  )
}

async function ledgerRows(userId: string) {
  return testDb.query<{ reason: string; delta: string; meta: Record<string, unknown> | null }>(
    `select reason, delta, meta from ledger where user_id = $1 and reason <> 'season_start' order by id`,
    [userId],
  )
}

async function today(): Promise<string> {
  return gameDay(await dbNow(db()))
}

describe('every endpoint', () => {
  it('needs a session', async () => {
    const { apiClient } = await import('../../helpers/api.ts')
    const anon = apiClient(economyApi)
    for (const [method, path] of [
      ['GET', '/api/economy/state'],
      ['GET', '/api/economy/hall-of-fame'],
      ['POST', '/api/economy/work'],
      ['POST', '/api/economy/hustle'],
      ['POST', '/api/economy/crime'],
      ['POST', '/api/economy/collect'],
      ['POST', '/api/economy/tier'],
      ['POST', '/api/economy/challenges/claim'],
      ['POST', '/api/economy/drops/claim'],
    ] as const) {
      const res = method === 'GET' ? await anon.get(path) : await anon.post(path, {}, key())
      expect(res.status, path).toBe(401)
    }
  })

  it('refuses bad input in plain words, and chip moves without a request key', async () => {
    const { client } = await player(10n)
    const extra = await client.post('/api/economy/work', { amount: 500 }, key())
    expect(extra.status).toBe(400)
    const tier = await client.post('/api/economy/tier', { tier: 'emperor' }, key())
    expect(tier.status).toBe(400)
    expect(tier.body.error.message).toBe('Pick a rank to buy.')
    const claim = await client.post('/api/economy/challenges/claim', { index: -1 }, key())
    expect(claim.status).toBe(400)
    const drop = await client.post('/api/economy/drops/claim', { dropId: 'one' }, key())
    expect(drop.status).toBe(400)
    const keyless = await client.post('/api/economy/work', {})
    expect(keyless.status).toBe(400)
    expect(keyless.body.error.code).toBe('missing_idempotency_key')
    const query = await client.get('/api/economy/state?debug=1')
    expect(query.status).toBe(400)
  })
})

describe('GET /api/economy/state', () => {
  it("shows a new player's economy: base rank, day 1 of a streak, three challenges", async () => {
    const { client } = await player(100n)
    const res = await client.get<EconomyStateResponse>('/api/economy/state')
    expect(res.status).toBe(200)
    const state = res.body.state
    if (!state) throw new Error('no state')
    expect(state.seasonId).toBe(seasonId)
    expect(state.income).toMatchObject({ tier: 'base', perDay: 500, capHours: 24 })
    expect(state.streak).toEqual({
      claimedToday: false,
      days: 1,
      bonus: 100,
      nextBonus: 200,
      maxBonus: 1_000,
    })
    expect(state.cooldowns).toEqual({ work: null, hustle: null, crime: null })
    expect(state.ranks.boughtToday).toBe(false)
    expect(state.ranks.next).toMatchObject({ tier: 'bronze', price: 15_000, perDay: 1_500 })
    expect(state.ranks.ladder.map((t) => t.tier)).toEqual([
      'base',
      'bronze',
      'silver',
      'gold',
      'platinum',
      'diamond',
      'crown',
    ])
    expect(state.challenges.list).toHaveLength(3)
    expect(state.challenges.list.map((c) => c.level)).toEqual([1, 2, 3])
    expect(state.challenges.list.map((c) => c.reward)).toEqual([200, 300, 400])
    expect(state.challenges.list.every((c) => c.game === null)).toBe(true)
    expect(state.activity).toEqual([])
  })

  it('keeps the same challenges all day', async () => {
    const { client } = await player(10n)
    const first = (await client.get<EconomyStateResponse>('/api/economy/state')).body.state
    const again = (await client.get<EconomyStateResponse>('/api/economy/state')).body.state
    expect(again?.challenges.list.map((c) => c.id)).toEqual(first?.challenges.list.map((c) => c.id))
  })
})

describe('POST /api/economy/work', () => {
  it('pays 2 to 6 whole chips with a line, then cools down for 5 minutes', async () => {
    const { id, client } = await player(0n)
    const res = await client.post<IncomeResponse>('/api/economy/work', {}, key())
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { result, wallet, state } = res.body
    expect(result.command).toBe('work')
    expect(result.outcome).toBe('paid')
    expect([200, 300, 400, 500, 600]).toContain(result.amount)
    expect(FULL_LINE_POOLS.work_lines).toContain(result.line)
    expect(wallet.balance).toBe(result.amount)
    expect(await balance(id)).toBe(BigInt(result.amount))
    const wait = Date.parse(result.readyAt) - (await dbNow(db())).getTime()
    expect(wait).toBeGreaterThan(4 * 60_000)
    expect(wait).toBeLessThanOrEqual(5 * 60_000)
    expect(state.cooldowns.work).toBe(result.readyAt)
    expect(state.activity[0]).toMatchObject({
      reason: 'work',
      delta: result.amount,
      line: result.line,
    })
    expect(await ledgerRows(id)).toEqual([
      { reason: 'work', delta: String(result.amount), meta: { line: result.line } },
    ])

    const again = await client.post('/api/economy/work', {}, key())
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('cooldown')
    expect(again.body.error.message).toMatch(/^Work is ready again in [45] minutes\.$/)
    expect(again.body.error.readyAt).toBe(result.readyAt)
  })

  it('returns the first answer to a replayed key and pays once', async () => {
    const { id, client } = await player(0n)
    const headers = key()
    const first = await client.post<IncomeResponse>('/api/economy/work', {}, headers)
    const second = await client.post<IncomeResponse>('/api/economy/work', {}, headers)
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(await balance(id)).toBe(BigInt(first.body.result.amount))
    expect(await ledgerRows(id)).toHaveLength(1)
  })

  it('pays once when pressed many times at once', async () => {
    const { id, client } = await player(0n)
    const results = await Promise.all(
      Array.from({ length: 6 }, () => client.post<IncomeResponse>('/api/economy/work', {}, key())),
    )
    const paid = results.filter((r) => r.status === 200)
    expect(paid).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(5)
    expect(await balance(id)).toBe(BigInt(paid[0]?.body.result.amount ?? -1))
  })

  it("tells the player's other tabs and the leaderboard, and keeps it out of chat", async () => {
    const { id, client } = await player(5n)
    const res = await client.post<IncomeResponse>('/api/economy/work', {}, key())
    await client.settle()
    const names = capture.events.map((e) => e.name)
    expect(names).toEqual(['wallet.updated', 'standing.changed', 'economy.changed'])
    const changed = capture.events.find((e) => e.name === 'economy.changed')
    expect(changed?.channel).toBe(`user:${id}`)
    expect(changed?.envelope.version).toBe(res.body.state.version)
    expect(res.body.state.version).toBe(1)
  })
})

describe('POST /api/economy/hustle and /crime', () => {
  it('fines 5 to 15 chips on a miss, stopping at an empty wallet', async () => {
    await setConfig('hustle_success_pct', 0)
    const { id, client } = await player(3n)
    const res = await client.post<IncomeResponse>('/api/economy/hustle', {}, key())
    expect(res.status).toBe(200)
    const { result } = res.body
    expect(result.outcome).toBe('fined')
    expect(result.drawn).toBeGreaterThanOrEqual(500)
    expect(result.drawn).toBeLessThanOrEqual(1_500)
    expect(result.amount).toBe(300)
    expect(FULL_LINE_POOLS.hustle_fine_lines).toContain(result.line)
    expect(await balance(id)).toBe(0n)
    expect(await ledgerRows(id)).toEqual([
      {
        reason: 'hustle_fine',
        delta: '-300',
        meta: { line: result.line, drawn: result.drawn },
      },
    ])
    expect(Date.parse(result.readyAt) - Date.now()).toBeGreaterThan(55 * 60_000)

    // With nothing left, the fine is nothing and no ledger row is written.
    await setConfig('crime_success_pct', 0)
    const broke = await client.post<IncomeResponse>('/api/economy/crime', {}, key())
    expect(broke.status).toBe(200)
    expect(broke.body.result).toMatchObject({ outcome: 'fined', amount: 0 })
    expect(await ledgerRows(id)).toHaveLength(1)
    expect(broke.body.state.cooldowns.crime).toBe(broke.body.result.readyAt)
  })

  it('pays 20 to 50 chips when the third button works, under its own name', async () => {
    await setConfig('hustle_success_pct', 10_000)
    const { client } = await player(0n)
    const res = await client.post<IncomeResponse>('/api/economy/hustle', {}, key())
    expect(res.body.result.outcome).toBe('paid')
    expect(res.body.result.amount % 100).toBe(0)
    expect(res.body.result.amount).toBeGreaterThanOrEqual(2_000)
    expect(res.body.result.amount).toBeLessThanOrEqual(5_000)
    expect(FULL_LINE_POOLS.hustle_win_lines).toContain(res.body.result.line)

    await setConfig('hustle_name', 'Moonlight')
    const again = await client.post('/api/economy/hustle', {}, key())
    expect(again.body.error.message).toMatch(/^Moonlight is ready again in/)
  })

  it('posts a crime that pays crime_chat_min or more, and nothing else', async () => {
    await setConfig('crime_success_pct', 10_000)
    await setConfig('crime_pay_min', 15_000)
    const { id, client } = await player(0n)
    const res = await client.post<IncomeResponse>('/api/economy/crime', {}, key())
    await client.settle()
    expect(res.body.result).toMatchObject({ outcome: 'paid', amount: 15_000, posted: true })
    const posts = capture.events.filter((e) => e.name === 'chat.message')
    expect(posts).toHaveLength(1)
    const post = posts[0]?.envelope.data as { body: string; meta: Record<string, unknown> }
    expect(post.body).toMatch(/pulled off a big crime and got away with 150 chips\.$/)
    expect(post.meta).toEqual({ tone: 'win', userId: id })

    await setConfig('crime_pay_min', 6_000)
    await setConfig('crime_pay_max', 6_000)
    const small = await player(0n)
    const quiet = await small.client.post<IncomeResponse>('/api/economy/crime', {}, key())
    expect(quiet.body.result).toMatchObject({ amount: 6_000, posted: false })
  })
})

describe('POST /api/economy/collect', () => {
  it("pays a day's base income and day 1's streak bonus, then nothing until more builds", async () => {
    const { id, client } = await player(0n, { joinedDaysAgo: 3 })
    // Income builds from the season's start a day ago, and caps at 24 hours.
    const res = await client.post<CollectResponse>('/api/economy/collect', {}, key())
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.collected).toEqual({ income: 500, bonus: 100, streak: 1 })
    expect(await balance(id)).toBe(600n)
    expect((await ledgerRows(id)).map((r) => [r.reason, r.delta])).toEqual([
      ['rank_income', '500'],
      ['daily_bonus', '100'],
    ])
    expect(res.body.state.streak).toMatchObject({ claimedToday: true, days: 1, bonus: 100 })
    expect(res.body.state.activity.map((a) => [a.reason, a.note])).toEqual([
      ['daily_bonus', 'Day 1'],
      ['rank_income', 'Base'],
    ])

    const again = await client.post('/api/economy/collect', {}, key())
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('nothing_to_collect')
  })

  it('pays income for the time since the last collect at the rank held', async () => {
    const { id, client } = await player(0n)
    await testDb.query(
      `insert into economy_players (season_id, user_id, collected_at) values ($1, $2, now() - interval '12 hours')`,
      [seasonId, id],
    )
    await testDb.query(`update wallets set tier = 'silver' where season_id = $1 and user_id = $2`, [
      seasonId,
      id,
    ])
    const res = await client.post<CollectResponse>('/api/economy/collect', {}, key())
    // Silver pays 100 a day: 12 hours is 50 chips (a few hundredths more for the seconds since).
    expect(res.body.collected.income).toBeGreaterThanOrEqual(5_000)
    expect(res.body.collected.income).toBeLessThan(5_010)
  })

  it('grows the streak a chip a day to 10, posting the day it maxes out', async () => {
    const { id, client } = await player(0n)
    const day = await today()
    await testDb.query(
      `insert into daily_state (season_id, user_id, game_day, bonus_claimed, streak) values ($1, $2, $3, true, 9)`,
      [seasonId, id, addGameDays(day, -1)],
    )
    const res = await client.post<CollectResponse>('/api/economy/collect', {}, key())
    await client.settle()
    expect(res.body.collected).toMatchObject({ bonus: 1_000, streak: 10 })
    const post = capture.events.find((e) => e.name === 'chat.message')
    expect((post?.envelope.data as { body: string }).body).toMatch(
      /has collected 10 days in a row\. The streak bonus is maxed at 10 chips a day\.$/,
    )

    // A missed day starts the streak over.
    const other = await player(0n)
    await testDb.query(
      `insert into daily_state (season_id, user_id, game_day, bonus_claimed, streak) values ($1, $2, $3, true, 6)`,
      [seasonId, other.id, addGameDays(day, -2)],
    )
    const reset = await other.client.post<CollectResponse>('/api/economy/collect', {}, key())
    expect(reset.body.collected).toMatchObject({ bonus: 100, streak: 1 })
  })
})

describe('POST /api/economy/tier', () => {
  it('buys the next rank: the price leaves the game and the new rank shows everywhere', async () => {
    const { id, client } = await player(200n)
    const res = await client.post<TierResponse>('/api/economy/tier', { tier: 'bronze' }, key())
    await client.settle()
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.bought).toEqual({ tier: 'bronze', price: 15_000, income: 1_500 })
    expect(await balance(id)).toBe(5_000n)
    expect(res.body.state.income).toMatchObject({ tier: 'bronze', perDay: 1_500 })
    expect(res.body.state.ranks).toMatchObject({ boughtToday: true, next: { tier: 'silver' } })
    const standing = capture.events.find((e) => e.name === 'standing.changed')
    expect(standing?.envelope.data).toMatchObject({ userId: id, tier: 'bronze', balance: 5_000 })
    const post = capture.events.find((e) => e.name === 'chat.message')
    expect((post?.envelope.data as { body: string }).body).toMatch(
      /ranked up to Bronze: 15 a day in income\.$/,
    )
    expect((await ledgerRows(id)).map((r) => [r.reason, r.delta])).toEqual([
      ['rank_purchase', '-15000'],
    ])
  })

  it('collects income at the old rate before the new rank starts paying', async () => {
    const { id, client } = await player(200n)
    await testDb.query(
      `insert into economy_players (season_id, user_id, collected_at) values ($1, $2, now() - interval '12 hours')`,
      [seasonId, id],
    )
    await client.post('/api/economy/tier', { tier: 'bronze' }, key())
    const rows = await ledgerRows(id)
    expect(rows.map((r) => r.reason)).toEqual(['rank_income', 'rank_purchase'])
    // Half a day at the base rate of 5 a day.
    expect(Number(rows[0]?.delta)).toBeGreaterThanOrEqual(250)
    expect(Number(rows[0]?.delta)).toBeLessThan(255)
    expect(rows[0]?.meta).toEqual({ tier: 'base' })
  })

  it('refuses a rank that is not next, still locked, already bought today, or too dear', async () => {
    const { id, client } = await player(100_000n)
    const skip = await client.post('/api/economy/tier', { tier: 'gold' }, key())
    expect(skip.status).toBe(409)
    expect(skip.body.error.message).toBe('You can only buy the next rank up: Bronze.')

    expect((await client.post('/api/economy/tier', { tier: 'bronze' }, key())).status).toBe(200)
    // Silver unlocks on day 3; the test season is on day 1 or 2.
    const locked = await client.post('/api/economy/tier', { tier: 'silver' }, key())
    expect(locked.status).toBe(409)
    expect(locked.body.error.code).toBe('tier_locked')

    await setConfig('tier_silver_unlock_day', 1)
    const twice = await client.post('/api/economy/tier', { tier: 'silver' }, key())
    expect(twice.status).toBe(409)
    expect(twice.body.error.code).toBe('tier_bought_today')

    const poor = await player(20n)
    const dear = await poor.client.post('/api/economy/tier', { tier: 'bronze' }, key())
    expect(dear.status).toBe(400)
    expect(dear.body.error.message).toBe(
      'Bronze costs 150 chips. You have 20 chips in your wallet.',
    )
    expect(await balance(poor.id)).toBe(2_000n)
    expect(await balance(id)).toBe(100_000n * CHIP - 15_000n)
  })

  it('buys one rank when two requests race', async () => {
    const { id, client } = await player(1_000n)
    const results = await Promise.all(
      [0, 1, 2].map(() => client.post('/api/economy/tier', { tier: 'bronze' }, key())),
    )
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await balance(id)).toBe(1_000n * CHIP - 15_000n)
  })
})

describe('POST /api/economy/challenges/claim', () => {
  async function withChallenges(userId: string, list: SavedChallenge[]) {
    await testDb.query(
      `insert into daily_state (season_id, user_id, game_day, challenges) values ($1, $2, $3, $4::jsonb)`,
      [seasonId, userId, await today(), JSON.stringify(list)],
    )
  }

  async function settledRound(userId: string, stake: number, payout: number, allIn = false) {
    const multiplier = (payout / stake).toFixed(4)
    await testDb.query(
      `insert into game_rounds (season_id, user_id, game, status, stake, payout, multiplier, all_in, settled_at)
       values ($1, $2, 'coinflip', 'settled', $3, $4, $5, $6, now())`,
      [seasonId, userId, stake, payout, multiplier, allIn],
    )
  }

  const list: SavedChallenge[] = [
    {
      id: 'rounds-3',
      metric: 'rounds',
      game: null,
      target: 3,
      level: 1,
      reward: 200,
      claimedAt: null,
    },
    { id: 'wins-3', metric: 'wins', game: null, target: 3, level: 2, reward: 300, claimedAt: null },
    {
      id: 'allInWins-1',
      metric: 'allInWins',
      game: null,
      target: 1,
      level: 3,
      reward: 400,
      claimedAt: null,
    },
  ]

  it("works progress out from the day's settled rounds and pays a finished one once", async () => {
    const { id, client } = await player(10n)
    await withChallenges(id, list)
    await settledRound(id, 100, 196)
    await settledRound(id, 100, 0)
    await settledRound(id, 100, 196)

    const state = (await client.get<EconomyStateResponse>('/api/economy/state')).body.state
    expect(state?.challenges.list.map((c) => [c.progress, c.done])).toEqual([
      [3, true],
      [2, false],
      [0, false],
    ])

    const res = await client.post<ChallengeClaimResponse>(
      '/api/economy/challenges/claim',
      { index: 0 },
      key(),
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.claimed).toEqual({ index: 0, reward: 200 })
    expect(res.body.state.challenges.list[0]?.claimed).toBe(true)
    expect(await balance(id)).toBe(1_200n)

    const twice = await client.post('/api/economy/challenges/claim', { index: 0 }, key())
    expect(twice.status).toBe(409)
    expect(twice.body.error.code).toBe('challenge_claimed')

    const early = await client.post('/api/economy/challenges/claim', { index: 1 }, key())
    expect(early.status).toBe(409)
    expect(early.body.error.message).toBe('That challenge is not done yet: 2 of 3.')

    const missing = await client.post('/api/economy/challenges/claim', { index: 7 }, key())
    expect(missing.status).toBe(404)

    expect((await ledgerRows(id)).map((r) => [r.reason, r.delta, r.meta])).toEqual([
      ['challenge', '200', { challenge: 'rounds-3' }],
    ])
  })

  it('pays a challenge once when claimed twice at once', async () => {
    const { id, client } = await player(1n)
    await withChallenges(id, list)
    await settledRound(id, 100, 0)
    await settledRound(id, 100, 0)
    await settledRound(id, 100, 0)
    const results = await Promise.all(
      [0, 1, 2].map(() => client.post('/api/economy/challenges/claim', { index: 0 }, key())),
    )
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await balance(id)).toBe(300n)
  })
})

describe('chat drops', () => {
  async function waitingDrop() {
    const [row] = await testDb.query<{ id: string; appears_at: Date }>(
      `select id, appears_at from economy_drops where season_id = $1 and posted_at is null`,
      [seasonId],
    )
    return row
  }

  async function landNow(client: { get: (path: string) => Promise<unknown> }) {
    await testDb.query(
      `update economy_drops set appears_at = now() - interval '1 second' where season_id = $1 and posted_at is null`,
      [seasonId],
    )
    forgetMoments()
    await client.get('/api/economy/state')
  }

  it('waits at a hidden time, 45 to 135 minutes away, that no response or event shows', async () => {
    const { client } = await player(0n)
    const res = await client.get<EconomyStateResponse>('/api/economy/state')
    const drop = await waitingDrop()
    if (!drop) throw new Error('no drop was scheduled')
    const minutes = (drop.appears_at.getTime() - Date.now()) / 60_000
    expect(minutes).toBeGreaterThan(44)
    expect(minutes).toBeLessThan(136)
    const fame = await client.get('/api/economy/hall-of-fame')
    await client.settle()
    const everything = JSON.stringify([res.body, fame.body, capture.events])
    expect(everything).not.toContain('appears')
    expect(everything).not.toContain(drop.appears_at.toISOString().slice(0, 19))
  })

  it('lands on the first request after its time, and the first three split it', async () => {
    const players = await Promise.all([0, 1, 2, 3].map(() => player(0n)))
    const [first] = players
    if (!first) throw new Error('no players')
    await first.client.get('/api/economy/state')
    await landNow(first.client)
    await first.client.settle()

    const post = capture.events.find((e) => e.name === 'chat.message')
    const message = post?.envelope.data as {
      id: number
      body: string
      meta: { drop: { id: number } }
    }
    expect(message.body).toBe('💰 Chat drop! 10 chips for the first 3 to grab it: 3.33 each.')
    expect(message.meta).toEqual({
      tone: 'win',
      drop: { id: message.meta.drop.id, pot: 1_000, winners: 3, share: 333 },
    })
    const dropId = message.meta.drop.id
    expect(await waitingDrop()).toBeDefined()

    const state = (await first.client.get<EconomyStateResponse>('/api/economy/state')).body.state
    expect(state?.drops[0]).toMatchObject({
      id: dropId,
      messageId: message.id,
      open: true,
      claims: [],
    })

    const claims = await Promise.all(
      players.map((p) =>
        p.client.post<DropClaimResponse>('/api/economy/drops/claim', { dropId }, key()),
      ),
    )
    expect(claims.filter((r) => r.status === 200)).toHaveLength(3)
    const late = claims.find((r) => r.status !== 200)
    expect(late?.status).toBe(409)
    expect((late?.body as unknown as { error: { message: string } }).error.message).toBe(
      'Too slow! All 3 shares are gone.',
    )
    for (const p of players) await p.client.settle()
    const claimed = capture.events.filter((e) => e.name === 'drop.claimed')
    expect(claimed.map((e) => e.envelope.version).sort()).toEqual([1, 2, 3])

    const winner = players[claims.findIndex((r) => r.status === 200)]
    if (!winner) throw new Error('no winner')
    expect(await balance(winner.id)).toBe(333n)
    const again = await winner.client.post('/api/economy/drops/claim', { dropId }, key())
    expect(again.status).toBe(409)
    const after = (await winner.client.get<EconomyStateResponse>('/api/economy/state')).body.state
    expect(after?.drops[0]).toMatchObject({ id: dropId, open: false })
    expect(after?.drops[0]?.claims).toHaveLength(3)
  })

  it('closes a drop when the next one lands', async () => {
    const { client } = await player(0n)
    await client.get('/api/economy/state')
    await landNow(client)
    const [older] = await testDb.query<{ id: string }>(
      `select id from economy_drops where season_id = $1 and posted_at is not null order by id desc limit 1`,
      [seasonId],
    )
    await landNow(client)
    const res = await client.post('/api/economy/drops/claim', { dropId: Number(older?.id) }, key())
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('drop_closed')
    const missing = await client.post('/api/economy/drops/claim', { dropId: 999_999 }, key())
    expect(missing.status).toBe(404)
  })
})
