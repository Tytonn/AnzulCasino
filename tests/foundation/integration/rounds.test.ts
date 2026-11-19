/**
 * The round helper (spec: The room model), through a stand-in game built
 * the way a lane builds one: typed bets against the locked wallet, one open
 * round per player per game, moves, raises, lowered stakes, payouts,
 * refunds, big bets and
 * their chat posts, idle rounds, the room's state, and that no secret ever
 * leaves the server.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { CHIP } from '../../../shared/chips.ts'
import { roundVersion } from '../../../shared/rounds.ts'
import { db } from '../../../server/lib/db.ts'
import { createApi, route } from '../../../server/lib/http.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import {
  defineServerGame,
  finishIdleRounds,
  latestWalletNews,
  playTransaction,
  roomState,
} from '../../../server/lib/rounds.ts'
import { ledgerMismatches, readWallet } from '../../../server/lib/wallet.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

process.env.DATABASE_POOL_MAX = '30'
const testDb = await useTestDatabase()

interface Detail {
  step: number
  note?: string
}
interface Secret {
  hidden: string
}
const SECRET = 'the-hidden-card-7f3a'

const dice = defineServerGame({ id: 'testdice', name: 'Test dice' })
const other = defineServerGame({ id: 'testother', name: 'Other game' })

const Bet = z.strictObject({ bet: z.string().max(32) })

/** A stand-in game's endpoints, written the way a lane writes them. */
const testApi = createApi([
  route({
    method: 'POST',
    path: '/api/testdice/start',
    auth: 'user',
    idempotent: true,
    input: Bet,
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.start<Detail, Secret>({
          bet: ctx.input.bet,
          detail: { step: 0 },
          secret: { hidden: SECRET },
        })
        return play.result(round)
      }),
  }),
  route({
    method: 'POST',
    path: '/api/testother/start',
    auth: 'user',
    idempotent: true,
    input: Bet,
    run: (ctx) =>
      playTransaction(ctx, other, async (play) =>
        play.result(await play.start({ bet: ctx.input.bet, detail: { step: 0 } })),
      ),
  }),
  route({
    method: 'POST',
    path: '/api/testdice/act',
    auth: 'user',
    idempotent: true,
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.require<Detail, Secret>()
        return play.result(await play.act(round, { detail: { step: round.detail.step + 1 } }))
      }),
  }),
  route({
    method: 'POST',
    path: '/api/testdice/raise',
    auth: 'user',
    idempotent: true,
    input: z.strictObject({ amount: z.number().int() }),
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.require<Detail, Secret>()
        const raised = await play.raise(round, {
          amount: BigInt(ctx.input.amount),
          detail: { step: round.detail.step + 1, note: 'doubled' },
        })
        return play.result(raised)
      }),
  }),
  route({
    method: 'POST',
    path: '/api/testdice/lower',
    auth: 'user',
    idempotent: true,
    input: z.strictObject({ amount: z.number().int() }),
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.require<Detail, Secret>()
        const lowered = await play.lower(round, {
          amount: BigInt(ctx.input.amount),
          detail: { step: round.detail.step + 1, note: 'one bet off' },
        })
        return play.result(lowered)
      }),
  }),
  route({
    method: 'POST',
    path: '/api/testdice/settle',
    auth: 'user',
    idempotent: true,
    input: z.strictObject({ payout: z.number().int().min(0) }),
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.require<Detail, Secret>()
        const settled = await play.settle(round, {
          payout: BigInt(ctx.input.payout),
          detail: { step: round.detail.step + 1, note: 'over' },
          summary: 'Six',
        })
        return play.result(settled)
      }),
  }),
  route({
    method: 'POST',
    path: '/api/testdice/refund',
    auth: 'user',
    idempotent: true,
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.require<Detail, Secret>()
        return play.result(
          await play.refund(round, { detail: { step: -1 }, summary: 'Called off' }),
        )
      }),
  }),
  route({
    method: 'POST',
    path: '/api/testdice/instant',
    auth: 'user',
    idempotent: true,
    // `times` in hundredths: 200 pays twice the stake, 0 loses it.
    input: z.strictObject({ bet: z.string().max(32), times: z.number().int().min(0) }),
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.start<Detail>({ bet: ctx.input.bet, detail: { step: 0 } })
        const payout = (round.stake * BigInt(ctx.input.times)) / 100n
        const settled = await play.settle(round, {
          payout,
          detail: { step: 1 },
          summary: payout > 0n ? 'Win' : 'Loss',
        })
        return play.result(settled)
      }),
  }),
  route({
    method: 'GET',
    path: '/api/testdice/room',
    auth: 'user',
    async run({ waitUntil }) {
      // The safest rule for this stand-in: hand the stake back as a push.
      await finishIdleRounds<Detail, Secret>(dice, waitUntil, async (play, round) => {
        await play.settle(round, {
          payout: round.stake,
          detail: { step: round.detail.step, note: 'finished for them' },
          summary: 'Stood',
        })
      })
      return roomState(dice)
    },
  }),
])

let seasonId: number
let capture: { events: Outgoing[]; stop(): void }

beforeAll(async () => {
  seasonId = await createSeason(testDb)
})

beforeEach(async () => {
  capture = captureLive()
  await testDb.query(`delete from rate_limits`)
})

afterEach(() => {
  capture.stop()
})

const key = () => ({ 'idempotency-key': randomUUID() })

/** A new player with `whole` chips, and their logged-in client. */
async function player(whole: bigint, name?: string) {
  const id = await createPlayer(testDb, name)
  await fundWallet(seasonId, id, whole * CHIP)
  const client = await loggedIn(testApi, id)
  return { id, client }
}

async function wallet(userId: string) {
  const found = await readWallet(db(), seasonId, userId)
  if (!found) throw new Error('no wallet')
  return found
}

function events(name: string) {
  return capture.events.filter((e) => e.name === name)
}

function roundRow(id: number) {
  return testDb
    .query<{
      status: string
      stake: string
      payout: string | null
      multiplier: string | null
      secret: unknown
      summary: string | null
      steps: number
      big_bet: boolean
      all_in: boolean
    }>(`select * from game_rounds where id = $1`, [id])
    .then((rows) => rows[0])
}

function ledgerFor(userId: string) {
  return testDb.query<{ delta: string; reason: string; ref_type: string; ref_id: string }>(
    `select delta, reason, ref_type, ref_id from ledger
     where season_id = $1 and user_id = $2 and reason <> 'season_start' order by id`,
    [seasonId, userId],
  )
}

describe('starting a round', () => {
  it('takes the stake, opens the round and tells the room, without the secret', async () => {
    const { id, client } = await player(100n)
    const res = await client.post('/api/testdice/start', { bet: '25' }, key())
    expect(res.status).toBe(200)
    expect(res.body.round).toMatchObject({
      game: 'testdice',
      userId: id,
      status: 'open',
      stake: 2500,
      payout: null,
      multiplier: null,
      detail: { step: 0 },
      summary: null,
      bigBet: false,
      allIn: false,
      steps: 0,
      settledAt: null,
    })
    expect(res.body.wallet).toMatchObject({ seasonId, balance: 7500, vault: 0 })
    expect(JSON.stringify(res.body)).not.toContain(SECRET)

    expect((await wallet(id)).balance).toBe(7500n)
    expect(await ledgerFor(id)).toEqual([
      { delta: '-2500', reason: 'bet', ref_type: 'game_round', ref_id: String(res.body.round.id) },
    ])
    expect((await roundRow(res.body.round.id))?.secret).toEqual({ hidden: SECRET })

    await client.settle()
    const [started] = events('round.started')
    expect(started?.channel).toBe('room:testdice')
    expect(started?.envelope.data).toEqual(res.body.round)
    expect(started?.envelope.version).toBe(roundVersion(res.body.round))
    expect(events('wallet.updated')[0]?.channel).toBe(`user:${id}`)
    expect(events('standing.changed')[0]?.envelope.data).toMatchObject({
      userId: id,
      netWorth: 7500,
    })
    expect(JSON.stringify(capture.events)).not.toContain(SECRET)
  })

  it('reads typed amounts against the wallet at that moment', async () => {
    const { id, client } = await player(100n)
    const half = await client.post('/api/testdice/instant', { bet: 'half', times: 0 }, key())
    expect(half.body.round.stake).toBe(5000)
    const small = await client.post('/api/testdice/instant', { bet: '0.025k', times: 100 }, key())
    expect(small.body.round.stake).toBe(2500)
    const all = await client.post('/api/testdice/instant', { bet: 'all', times: 0 }, key())
    expect(all.body.round).toMatchObject({ stake: 5000, allIn: true, bigBet: true })
    expect((await wallet(id)).balance).toBe(0n)
  })

  it('refuses amounts it cannot take, in plain words', async () => {
    const { id, client } = await player(100n)
    const tries: [string, string][] = [
      ['lots', '"lots" is not an amount. Try 50, 2.5k, half or all.'],
      ['0.5', 'The smallest bet is 1.'],
      ['101', 'You only have 100 chips.'],
      ['0', 'Bet more than zero.'],
    ]
    for (const [bet, message] of tries) {
      const res = await client.post('/api/testdice/start', { bet }, key())
      expect(res.status, bet).toBe(400)
      expect(res.body.error).toMatchObject({ code: 'bad_bet', message })
    }
    expect((await wallet(id)).balance).toBe(100n * CHIP)
    expect(await ledgerFor(id)).toEqual([])
  })

  it('allows one open round per game, and another game at the same time', async () => {
    const { client } = await player(100n)
    expect((await client.post('/api/testdice/start', { bet: '10' }, key())).status).toBe(200)
    const again = await client.post('/api/testdice/start', { bet: '10' }, key())
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('round_open')
    expect((await client.post('/api/testother/start', { bet: '10' }, key())).status).toBe(200)
  })

  it('opens one round when many starts race, and never overdraws', async () => {
    const { id, client } = await player(100n)
    const results = await Promise.all(
      Array.from({ length: 12 }, () => client.post('/api/testdice/start', { bet: '60' }, key())),
    )
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    for (const r of results.filter((r) => r.status !== 200)) {
      expect([400, 409]).toContain(r.status)
    }
    expect((await wallet(id)).balance).toBe(40n * CHIP)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('flags all-ins and stakes at or above big_bet_pct of net worth', async () => {
    const { client } = await player(100n)
    // 50 of 100 is exactly big_bet_pct (50%).
    const big = await client.post('/api/testdice/instant', { bet: '50', times: 100 }, key())
    expect(big.body.round).toMatchObject({ bigBet: true, allIn: false })
    const small = await client.post('/api/testdice/instant', { bet: '49.99', times: 100 }, key())
    expect(small.body.round).toMatchObject({ bigBet: false, allIn: false })
  })

  it('refuses new bets once the season is over, but lets an open round finish', async () => {
    // Only one season runs at a time: park the shared one while this test runs.
    await testDb.query(
      `update seasons set status = 'scheduled', starts_at = now() + interval '400 days',
       ends_at = now() + interval '430 days' where id = $1`,
      [seasonId],
    )
    try {
      const ending = await createSeason(testDb)
      const id = await createPlayer(testDb)
      await fundWallet(ending, id, 100n * CHIP)
      const client = await loggedIn(testApi, id)
      expect((await client.post('/api/testdice/start', { bet: '10' }, key())).status).toBe(200)
      await testDb.query(`update seasons set ends_at = now() - interval '1 second' where id = $1`, [
        ending,
      ])
      const refused = await client.post('/api/testother/start', { bet: '10' }, key())
      expect(refused.status).toBe(409)
      expect(refused.body.error.code).toBe('season_over')
      const settled = await client.post('/api/testdice/settle', { payout: 2000 }, key())
      expect(settled.status).toBe(200)
      expect(settled.body.wallet).toMatchObject({ seasonId: ending, balance: 11_000 })
    } finally {
      await testDb.query(
        `update seasons set status = 'active', starts_at = now() - interval '1 day',
         ends_at = now() + interval '29 days' where id = $1`,
        [seasonId],
      )
    }
  })
})

describe('moves', () => {
  it('saves each move, counts it and tells the room, keeping the secret on the server', async () => {
    const { client } = await player(100n)
    const start = await client.post('/api/testdice/start', { bet: '10' }, key())
    const one = await client.post('/api/testdice/act', {}, key())
    const two = await client.post('/api/testdice/act', {}, key())
    expect(two.body.round).toMatchObject({ id: start.body.round.id, steps: 2, detail: { step: 2 } })
    expect((await roundRow(start.body.round.id))?.secret).toEqual({ hidden: SECRET })

    await client.settle()
    const actions = events('round.action')
    expect(actions.map((e) => e.envelope.version)).toEqual([
      roundVersion(one.body.round),
      roundVersion(two.body.round),
    ])
    expect(roundVersion(two.body.round)).toBeGreaterThan(roundVersion(start.body.round))
    expect(JSON.stringify(capture.events)).not.toContain(SECRET)
  })

  it('refuses a move with no round open', async () => {
    const { client } = await player(100n)
    const res = await client.post('/api/testdice/act', {}, key())
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'no_round',
      message: 'You have no round going here. Place a bet first.',
    })
  })

  it('raises the stake from the wallet, and marks an all-in when it empties it', async () => {
    const { id, client } = await player(100n)
    const start = await client.post('/api/testdice/start', { bet: '30' }, key())
    const raised = await client.post('/api/testdice/raise', { amount: 3000 }, key())
    expect(raised.body.round).toMatchObject({ stake: 6000, allIn: false, bigBet: true })
    expect(raised.body.wallet.balance).toBe(4000)
    const broke = await client.post('/api/testdice/raise', { amount: 5000 }, key())
    expect(broke.status).toBe(400)
    expect(broke.body.error.code).toBe('insufficient_funds')
    const all = await client.post('/api/testdice/raise', { amount: 4000 }, key())
    expect(all.body.round).toMatchObject({ stake: 10_000, allIn: true })
    expect(await ledgerFor(id)).toEqual(
      ['-3000', '-3000', '-4000'].map((delta) => ({
        delta,
        reason: 'bet',
        ref_type: 'game_round',
        ref_id: String(start.body.round.id),
      })),
    )
  })
})

describe('lowering the stake', () => {
  it('hands part of the stake back and keeps the round open', async () => {
    const { id, client } = await player(100n)
    const start = await client.post('/api/testdice/start', { bet: '30' }, key())
    const all = await client.post('/api/testdice/raise', { amount: 7000 }, key())
    expect(all.body.round).toMatchObject({ stake: 10_000, allIn: true, bigBet: true })
    capture.events.length = 0

    const res = await client.post('/api/testdice/lower', { amount: 6000 }, key())
    expect(res.status).toBe(200)
    // 40 of the 100 the player held is under big_bet_pct (50%), and chips are back home.
    expect(res.body.round).toMatchObject({
      status: 'open',
      stake: 4000,
      allIn: false,
      bigBet: false,
      steps: 2,
      detail: { step: 2, note: 'one bet off' },
    })
    expect(res.body.round).not.toHaveProperty('secret')
    expect(res.body.wallet.balance).toBe(6000)
    expect((await roundRow(start.body.round.id))?.secret).toEqual({ hidden: SECRET })

    const roundId = String(start.body.round.id)
    expect(await ledgerFor(id)).toEqual([
      { delta: '-3000', reason: 'bet', ref_type: 'game_round', ref_id: roundId },
      { delta: '-7000', reason: 'bet', ref_type: 'game_round', ref_id: roundId },
      { delta: '6000', reason: 'refund', ref_type: 'game_round', ref_id: roundId },
    ])
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])

    await client.settle()
    expect(events('round.action').map((e) => e.channel)).toEqual(['room:testdice'])
    expect(events('round.action')[0]?.envelope.data).toMatchObject({ stake: 4000 })
    expect(events('wallet.updated')).toHaveLength(1)

    // What is left plays on: a 2x payout is on the 40 still in the round.
    const settled = await client.post('/api/testdice/settle', { payout: 8000 }, key())
    expect(settled.body.round).toMatchObject({ status: 'settled', stake: 4000, payout: 8000 })
    expect(settled.body.round.multiplier).toBe(200)
    expect((await wallet(id)).balance).toBe(14_000n)
  })

  it('keeps a big bet big while what is left is still big', async () => {
    const { client } = await player(100n)
    await client.post('/api/testdice/start', { bet: '80' }, key())
    const res = await client.post('/api/testdice/lower', { amount: 2000 }, key())
    expect(res.body.round).toMatchObject({ stake: 6000, bigBet: true, allIn: false })
  })

  it('refuses to hand back nothing, or the whole stake, and changes nothing', async () => {
    const { id, client } = await player(100n)
    await client.post('/api/testdice/start', { bet: '40' }, key())
    for (const amount of [0, -100, 4000, 5000]) {
      const res = await client.post('/api/testdice/lower', { amount }, key())
      expect(res.status, String(amount)).toBe(400)
      expect(res.body.error.code).toBe('bad_bet')
    }
    expect((await ledgerFor(id)).map((r) => [r.delta, r.reason])).toEqual([['-4000', 'bet']])
    expect((await wallet(id)).balance).toBe(6000n)

    await client.post('/api/testdice/refund', {}, key())
    const none = await client.post('/api/testdice/lower', { amount: 1000 }, key())
    expect(none.status).toBe(409)
    expect(none.body.error.code).toBe('no_round')
  })
})

describe('settling', () => {
  it('pays out, closes the round, clears the secret and tells the room and the ticker', async () => {
    const { id, client } = await player(100n)
    const start = await client.post('/api/testdice/start', { bet: '20' }, key())
    const res = await client.post('/api/testdice/settle', { payout: 3920 }, key())
    expect(res.body.round).toMatchObject({
      status: 'settled',
      stake: 2000,
      payout: 3920,
      multiplier: 196,
      summary: 'Six',
      detail: { step: 1, note: 'over' },
      steps: 1,
    })
    expect(res.body.wallet.balance).toBe(10_000 - 2000 + 3920)
    const row = await roundRow(start.body.round.id)
    expect(row).toMatchObject({ status: 'settled', secret: null, multiplier: '1.9600' })
    expect((await ledgerFor(id)).map((r) => [r.delta, r.reason])).toEqual([
      ['-2000', 'bet'],
      ['3920', 'payout'],
    ])

    await client.settle()
    const room = events('round.settled').find((e) => e.channel === 'room:testdice')
    expect(room?.envelope.data).toEqual(res.body.round)
    const ticker = events('round.settled').find((e) => e.channel === 'feed')
    expect(ticker?.envelope).toMatchObject({
      version: start.body.round.id,
      data: {
        seasonId,
        roundId: start.body.round.id,
        game: 'testdice',
        userId: id,
        stake: 2000,
        payout: 3920,
        net: 1920,
        multiplier: 196,
        summary: 'Six',
        bigBet: false,
      },
    })
    const again = await client.post('/api/testdice/settle', { payout: 3920 }, key())
    expect(again.body.error.code).toBe('no_round')
  })

  it('pays nothing on a loss, and writes no payout row', async () => {
    const { id, client } = await player(100n)
    const res = await client.post('/api/testdice/instant', { bet: '10', times: 0 }, key())
    expect(res.body.round).toMatchObject({ payout: 0, multiplier: 0 })
    expect((await ledgerFor(id)).map((r) => r.reason)).toEqual(['bet'])
  })

  it('sends one wallet and leaderboard update per request, the latest', async () => {
    const { id, client } = await player(100n)
    const res = await client.post('/api/testdice/instant', { bet: '10', times: 300 }, key())
    await client.settle()
    const wallets = events('wallet.updated')
    expect(wallets).toHaveLength(1)
    expect(wallets[0]?.envelope.data).toMatchObject({ balance: 12_000 })
    expect(events('standing.changed')).toHaveLength(1)
    expect(res.body.wallet).toMatchObject({
      balance: 12_000,
      version: wallets[0]?.envelope.version,
    })
    expect(events('round.started')).toHaveLength(1)
    expect(id).toBeTruthy()
  })

  it('returns the first result for a repeated key and changes nothing', async () => {
    const { id, client } = await player(100n)
    const headers = key()
    const first = await client.post('/api/testdice/instant', { bet: '10', times: 200 }, headers)
    const second = await client.post('/api/testdice/instant', { bet: '10', times: 200 }, headers)
    expect(second.body).toEqual(first.body)
    expect((await wallet(id)).balance).toBe(110n * CHIP)
    await client.settle()
    expect(events('round.settled').filter((e) => e.channel === 'feed')).toHaveLength(1)
  })

  it('posts big wins and big losses in chat, and nothing for ordinary rounds', async () => {
    await testDb.query(`delete from chat_messages`)
    const { id, client } = await player(1_000n, `big_${randomUUID().slice(0, 6)}`)
    const name = (
      await testDb.query<{ display_name: string }>(`select display_name from users where id = $1`, [
        id,
      ])
    )[0]?.display_name
    // 10x the bet: a big win.
    await client.post('/api/testdice/instant', { bet: '10', times: 1_000 }, key())
    // 9.99x and a small loss: nothing.
    await client.post('/api/testdice/instant', { bet: '10', times: 999 }, key())
    await client.post('/api/testdice/instant', { bet: '10', times: 0 }, key())
    // A lost big bet, then a won all-in, then a lost all-in.
    const balance = Number((await wallet(id)).balance) / 100
    await client.post(
      '/api/testdice/instant',
      { bet: String(Math.ceil(balance / 2)), times: 0 },
      key(),
    )
    await client.post('/api/testdice/instant', { bet: 'all', times: 200 }, key())
    await client.post('/api/testdice/instant', { bet: 'all', times: 0 }, key())

    const posts = await testDb.query<{ kind: string; body: string; meta: { tone: string } }>(
      `select kind, body, meta from chat_messages order by id`,
    )
    expect(posts.map((p) => [p.meta.tone, p.body])).toEqual([
      ['win', `${name} won 90 on Test dice, 10x the bet`],
      ['loss', `${name} lost ${Math.ceil(balance / 2).toLocaleString('en-US')} on Test dice`],
      ['win', expect.stringMatching(new RegExp(`^${name} went all in on Test dice and won `))],
      ['loss', expect.stringMatching(new RegExp(`^${name} went all in on Test dice and lost `))],
    ])
    expect(posts.every((p) => p.kind === 'system')).toBe(true)
    await client.settle()
    expect(events('chat.message')).toHaveLength(4)
  })
})

describe('refunds', () => {
  it('voids the round and hands the stake back, without a ticker entry', async () => {
    const { id, client } = await player(100n)
    await client.post('/api/testdice/start', { bet: '40' }, key())
    const res = await client.post('/api/testdice/refund', {}, key())
    expect(res.body.round).toMatchObject({ status: 'void', payout: 4000, summary: 'Called off' })
    expect(res.body.wallet.balance).toBe(10_000)
    expect((await ledgerFor(id)).map((r) => [r.delta, r.reason])).toEqual([
      ['-4000', 'bet'],
      ['4000', 'refund'],
    ])
    await client.settle()
    expect(events('round.settled').map((e) => e.channel)).toEqual(['room:testdice'])
  })
})

describe('the room', () => {
  it("shows each player's latest round, open or just finished, and no secrets", async () => {
    const a = await player(100n)
    const b = await player(100n)
    await a.client.post('/api/testdice/instant', { bet: '5', times: 200 }, key())
    const latest = await a.client.post('/api/testdice/start', { bet: '7' }, key())
    const done = await b.client.post('/api/testdice/instant', { bet: '3', times: 0 }, key())
    const room = await a.client.get('/api/testdice/room')
    expect(room.status).toBe(200)
    const mine = room.body.rounds.filter((r: { userId: string }) => [a.id, b.id].includes(r.userId))
    expect(mine).toHaveLength(2)
    expect(mine).toEqual(expect.arrayContaining([latest.body.round, done.body.round]))
    expect(JSON.stringify(room.body)).not.toContain(SECRET)
  })

  it('finishes rounds left idle by the safest rule, and leaves active ones alone', async () => {
    const idle = await player(100n)
    const active = await player(100n)
    const stale = await idle.client.post('/api/testdice/start', { bet: '20' }, key())
    const fresh = await active.client.post('/api/testdice/start', { bet: '20' }, key())
    await testDb.query(
      `update game_rounds set acted_at = now() - interval '11 minutes' where id = $1`,
      [stale.body.round.id],
    )
    const room = await active.client.get('/api/testdice/room')
    const seen = new Map(room.body.rounds.map((r: { id: number }) => [r.id, r]))
    expect(seen.get(stale.body.round.id)).toMatchObject({
      status: 'settled',
      payout: 2000,
      summary: 'Stood',
      detail: { note: 'finished for them' },
    })
    expect(seen.get(fresh.body.round.id)).toMatchObject({ status: 'open' })
    expect((await wallet(idle.id)).balance).toBe(100n * CHIP)
    expect((await roundRow(stale.body.round.id))?.secret).toBeNull()
    await active.client.settle()
    expect(events('round.settled').some((e) => e.channel === `room:testdice`)).toBe(true)
  })
})

describe('latestWalletNews', () => {
  it("keeps each player's last wallet and standing news and everything else in order", () => {
    const e = (channel: string, name: string, data: object) =>
      ({ channel, name, envelope: { id: name, at: 0, version: 0, data } }) as Outgoing
    const list = [
      e('room:x', 'round.started', {}),
      e('user:a', 'wallet.updated', { balance: 1 }),
      e('feed', 'standing.changed', { userId: 'a', balance: 1 }),
      e('feed', 'standing.changed', { userId: 'b', balance: 5 }),
      e('room:x', 'round.settled', {}),
      e('user:a', 'wallet.updated', { balance: 2 }),
      e('feed', 'standing.changed', { userId: 'a', balance: 2 }),
    ]
    expect(latestWalletNews(list).map((x) => [x.name, x.envelope.data])).toEqual([
      ['round.started', {}],
      ['standing.changed', { userId: 'b', balance: 5 }],
      ['round.settled', {}],
      ['wallet.updated', { balance: 2 }],
      ['standing.changed', { userId: 'a', balance: 2 }],
    ])
  })
})
