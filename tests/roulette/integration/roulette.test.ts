/**
 * Roulette's endpoints against a real database (spec: Games > Roulette and
 * the Quality bar): chips leave the wallet as bets go down and come back as
 * bets come off, one draw per spin pays every bet in the same transaction,
 * late bets are refused, replays change nothing, parallel requests cannot
 * overdraw or draw twice, and nothing hidden or early leaves the server.
 *
 * The tests move the wheel's clock instead of waiting for it: betting runs
 * five minutes, and a test opens or closes a spin by moving the latest saved
 * spin's times (or the season's start before any spin is saved).
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHIP } from '../../../shared/chips.ts'
import {
  type RouletteClock,
  type RouletteDetail,
  type RouletteTable,
  type SettleResponse,
  settleBets,
} from '../../../shared/games/roulette.ts'
import type { PlayResult, RoomState } from '../../../shared/rounds.ts'
import { rouletteApi } from '../../../server/games/roulette/api.ts'
import type * as Rules from '../../../server/games/roulette/rules.ts'
import { sweepUnsettledSpins } from '../../../server/games/roulette/spins.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { ledgerMismatches, readWallet } from '../../../server/lib/wallet.ts'
import { apiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

// The number a test wants drawn next; otherwise the real draw.
const draws = vi.hoisted(() => ({ next: [] as number[] }))
vi.mock('../../../server/games/roulette/rules.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Rules>()
  return { ...actual, drawNumber: () => draws.next.shift() ?? actual.drawNumber() }
})

process.env.DATABASE_POOL_MAX = '40'
const testDb = await useTestDatabase()

type Bet = PlayResult<RouletteDetail>
/** A refusal's body; a 200 has none. */
type Refusal = { error: { code: string; message: string; clock: RouletteClock } }

const BETTING = 300
const SPIN = 7
const RESULT = 3
const CYCLE = BETTING + SPIN + RESULT

let seasonId: number
let capture: { events: Outgoing[]; stop(): void }

beforeAll(async () => {
  seasonId = await createSeason(testDb)
  // Five minutes of betting, so no test races the close.
  for (const [key, value] of [
    ['roulette_betting_seconds', BETTING],
    ['roulette_spin_seconds', SPIN],
    ['roulette_result_seconds', RESULT],
  ] as const) {
    await testDb.query(
      `insert into config (key, value, effective_at) values ($1, $2::jsonb, now() - interval '1 hour')`,
      [key, JSON.stringify(value)],
    )
  }
})

beforeEach(async () => {
  capture = captureLive()
  draws.next = []
  await testDb.query(`delete from rate_limits`)
})

afterEach(() => {
  capture.stop()
})

const key = () => ({ 'idempotency-key': randomUUID() })

async function player(whole: bigint) {
  const id = await createPlayer(testDb)
  await fundWallet(seasonId, id, whole * CHIP)
  return { id, client: await loggedIn(rouletteApi, id) }
}

async function balance(userId: string): Promise<bigint> {
  const wallet = await readWallet(db(), seasonId, userId)
  if (!wallet) throw new Error('no wallet')
  return wallet.balance
}

async function latestSpinRow() {
  const [row] = await testDb.query<{ id: string; round_no: string }>(
    `select id, round_no from shared_rounds where season_id = $1 and game = 'roulette'
     order by round_no desc limit 1`,
    [seasonId],
  )
  return row ?? null
}

/** Opens the spin after the latest saved one, `ago` seconds ago. Returns its number. */
async function nextSpin(ago = 1): Promise<number> {
  const latest = await latestSpinRow()
  if (!latest) {
    await testDb.query(
      `update seasons set starts_at = now() - make_interval(secs => $2) where id = $1`,
      [seasonId, ago],
    )
    return 0
  }
  // The latest spin ran a whole cycle that ended `ago` seconds ago.
  await testDb.query(
    `update shared_rounds set opens_at = now() - make_interval(secs => $2),
       closes_at = now() - make_interval(secs => $3) where id = $1`,
    [latest.id, CYCLE + ago, CYCLE + ago - BETTING],
  )
  return Number(latest.round_no) + 1
}

/** Closes a saved spin's betting a second ago: the wheel is spinning. */
async function closeSpin(spin: number): Promise<void> {
  await testDb.query(
    `update shared_rounds set opens_at = now() - make_interval(secs => $3),
       closes_at = now() - interval '1 second'
     where season_id = $1 and game = 'roulette' and round_no = $2`,
    [seasonId, spin, BETTING + 1],
  )
}

async function spinRow(spin: number) {
  const [row] = await testDb.query<{
    id: string
    state: string
    result: { number: number | null } | null
    secret: unknown
    settled_at: Date | null
  }>(
    `select id, state, result, secret, settled_at from shared_rounds
     where season_id = $1 and game = 'roulette' and round_no = $2`,
    [seasonId, spin],
  )
  return row ?? null
}

async function roundsOf(userId: string) {
  return testDb.query<{
    id: string
    status: string
    stake: string
    payout: string | null
    detail: RouletteDetail
    shared_round_id: string | null
  }>(
    `select id, status, stake, payout, detail, shared_round_id from game_rounds
     where user_id = $1 order by id`,
    [userId],
  )
}

async function ledgerOf(userId: string) {
  return testDb.query<{ reason: string; amount: string }>(
    `select reason, delta as amount from ledger where user_id = $1 and reason <> 'season_start' order by id`,
    [userId],
  )
}

const bet = (
  client: Awaited<ReturnType<typeof player>>['client'],
  spin: number,
  bets: [string, string][],
) =>
  client.post<Bet & Refusal>(
    '/api/roulette/bet',
    { spin, bets: bets.map(([spot, amount]) => ({ spot, bet: amount })) },
    key(),
  )

const settle = (client: Awaited<ReturnType<typeof player>>['client'], spin: number) =>
  client.post<SettleResponse>('/api/roulette/settle', { spin }, key())

describe('placing bets', () => {
  it('takes the chips at once and keeps every bet on the spin in one round', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(100n)

    const first = await bet(client, spin, [
      ['red', '10'],
      ['17', '2'],
    ])
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    expect(first.body.round.status).toBe('open')
    expect(first.body.round.stake).toBe(12_00)
    expect(first.body.round.detail).toEqual({
      spin,
      bets: [
        { spot: 'red', amount: 10_00 },
        { spot: '17', amount: 2_00 },
      ],
      number: null,
      wins: [],
    })
    expect(first.body.wallet.balance).toBe(88_00)
    expect(await balance(id)).toBe(88_00n)

    // A later bet joins the same round, onto a spot already bet or a new one.
    const second = await bet(client, spin, [
      ['red', '5'],
      ['0', '1'],
    ])
    expect(second.status, JSON.stringify(second.body)).toBe(200)
    expect(second.body.round.id).toBe(first.body.round.id)
    expect(second.body.round.stake).toBe(18_00)
    expect(second.body.round.detail.bets).toEqual([
      { spot: 'red', amount: 15_00 },
      { spot: '17', amount: 2_00 },
      { spot: '0', amount: 1_00 },
    ])
    expect(await balance(id)).toBe(82_00n)

    // One shared row for the spin, taking bets, with no number yet.
    const row = await spinRow(spin)
    expect(row?.state).toBe('betting')
    expect(row?.result?.number).toBeNull()
    expect(row?.settled_at).toBeNull()
    const rounds = await roundsOf(id)
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.shared_round_id).toBe(row?.id)
    // One ledger row opens the round, and one more per request after it.
    expect((await ledgerOf(id)).map((l) => [l.reason, Number(l.amount)])).toEqual([
      ['bet', -10_00],
      ['bet', -2_00],
      ['bet', -6_00],
    ])

    // The room hears the bets, with no number in them.
    await client.settle()
    const room = capture.events.filter((e) => e.channel.endsWith('room:roulette'))
    expect(room.map((e) => e.name)).toEqual(['round.started', 'round.action', 'round.action'])
  })

  it('resolves typed amounts in order: "all" after "10" bets the rest', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(50n)
    const res = await bet(client, spin, [
      ['black', '10'],
      ['red', 'all'],
    ])
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.round.detail.bets).toEqual([
      { spot: 'black', amount: 10_00 },
      { spot: 'red', amount: 40_00 },
    ])
    expect(res.body.round.allIn).toBe(true)
    expect(await balance(id)).toBe(0n)
  })

  it('refuses bets outside the limits, in plain words', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(20n)
    const tiny = await bet(client, spin, [['red', '0.5']])
    expect(tiny.status).toBe(400)
    expect(tiny.body.error.message).toBe('The smallest bet is 1.')
    const tooMuch = await bet(client, spin, [
      ['red', '15'],
      ['black', '15'],
    ])
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error.message).toBe('Black: You only have 5 chips.')
    // Nothing went down from the refused request.
    expect(await balance(id)).toBe(20_00n)
    expect(await roundsOf(id)).toHaveLength(0)

    const { client: broke } = await player(0n)
    const empty = await bet(broke, spin, [['red', 'all']])
    expect(empty.status).toBe(400)
    expect(empty.body.error.message).toBe('Your wallet is empty.')
  })

  it('refuses a bet for a spin that is not taking bets, and says where the wheel is', async () => {
    const spin = await nextSpin()
    const { client } = await player(20n)
    // Make sure the spin is saved, so the clock anchors on it.
    expect((await bet(client, spin, [['red', '1']])).status).toBe(200)

    const ahead = await bet(client, spin + 1, [['red', '1']])
    expect(ahead.status).toBe(409)
    expect(ahead.body.error.code).toBe('spin_not_open')
    expect(ahead.body.error.clock.anchor.spin).toBe(spin)

    const behind = await bet(client, spin - 1, [['red', '1']])
    expect(behind.status).toBe(409)
    expect(behind.body.error.code).toBe('spin_closed')
    expect(behind.body.error.message).toMatch(/Too late/)
  })
})

describe('taking bets off', () => {
  it('hands back part of a spot, a whole spot, or every bet, until the close', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(100n)
    const placed = await bet(client, spin, [
      ['red', '20'],
      ['17', '5'],
    ])
    expect(placed.status).toBe(200)

    // Part of red.
    const part = await client.post<Bet>(
      '/api/roulette/remove',
      { spin, spot: 'red', amount: 5_00 },
      key(),
    )
    expect(part.status, JSON.stringify(part.body)).toBe(200)
    expect(part.body.round.status).toBe('open')
    expect(part.body.round.id).toBe(placed.body.round.id)
    expect(part.body.round.stake).toBe(20_00)
    expect(part.body.round.detail.bets).toEqual([
      { spot: 'red', amount: 15_00 },
      { spot: '17', amount: 5_00 },
    ])
    expect(await balance(id)).toBe(80_00n)

    // Leaving less than the smallest bet is refused.
    const crumbs = await client.post(
      '/api/roulette/remove',
      { spin, spot: 'red', amount: 14_50 },
      key(),
    )
    expect(crumbs.status).toBe(400)
    expect(crumbs.body.error.message).toBe('Leave at least 1 on Red, or take it all off.')

    // A whole spot.
    const whole = await client.post<Bet>('/api/roulette/remove', { spin, spot: '17' }, key())
    expect(whole.status).toBe(200)
    expect(whole.body.round.detail.bets).toEqual([{ spot: 'red', amount: 15_00 }])
    expect(await balance(id)).toBe(85_00n)

    // A spot with nothing on it.
    const none = await client.post('/api/roulette/remove', { spin, spot: '18' }, key())
    expect(none.status).toBe(400)
    expect(none.body.error.message).toBe('You have no chips on 18.')

    // Clearing hands back the rest and closes the round.
    const cleared = await client.post<Bet>('/api/roulette/clear', { spin }, key())
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200)
    expect(cleared.body.round.status).toBe('void')
    expect(cleared.body.round.detail.bets).toEqual([])
    expect(await balance(id)).toBe(100_00n)

    // The ledger shows every chip: two bets out, three refunds back.
    const ledger = await ledgerOf(id)
    expect(ledger.map((l) => [l.reason, Number(l.amount)])).toEqual([
      ['bet', -20_00],
      ['bet', -5_00],
      ['refund', 5_00],
      ['refund', 5_00],
      ['refund', 15_00],
    ])

    // A new bet on the same spin starts a fresh round.
    const again = await bet(client, spin, [['black', '3']])
    expect(again.status).toBe(200)
    expect(again.body.round.id).not.toBe(placed.body.round.id)
    expect(again.body.round.detail.bets).toEqual([{ spot: 'black', amount: 3_00 }])
  })
})

describe('the draw', () => {
  it('draws once betting closes and pays every bet on the spin in the same transaction', async () => {
    const spin = await nextSpin()
    const everyNumber = await player(100n)
    const outside = await player(100n)
    const single = await player(100n)
    const allIn = await player(30n)

    // 1 chip on each of the 37 numbers; red and black; 2 on 17; everything on 1.
    const numbers: [string, string][] = Array.from({ length: 37 }, (_, n) => [String(n), '1'])
    expect((await bet(everyNumber.client, spin, numbers)).status).toBe(200)
    expect(
      (
        await bet(outside.client, spin, [
          ['red', '10'],
          ['black', '10'],
        ])
      ).status,
    ).toBe(200)
    expect((await bet(single.client, spin, [['17', '2']])).status).toBe(200)
    expect((await bet(allIn.client, spin, [['1', 'all']])).status).toBe(200)

    // Before the close there is nothing to draw.
    const early = await settle(single.client, spin)
    expect(early.status).toBe(200)
    expect(early.body.state).toBe('open')

    await closeSpin(spin)
    capture.events.length = 0
    draws.next = [17]
    const drawn = await settle(outside.client, spin)
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200)
    if (drawn.body.state !== 'drawn') throw new Error(`expected a draw: ${drawn.body.state}`)
    expect(drawn.body.result.spin).toBe(spin)
    expect(drawn.body.result.number).toBe(17)
    expect(drawn.body.window.spin).toBe(spin)

    // 17 is black: every number pays 36 of the 37 chips, black doubles,
    // the single number pays 36 times, and the all-in on 1 loses.
    expect(await balance(everyNumber.id)).toBe(99_00n)
    expect(await balance(outside.id)).toBe(100_00n)
    expect(await balance(single.id)).toBe(170_00n)
    expect(await balance(allIn.id)).toBe(0n)

    const [round] = await roundsOf(single.id)
    expect(round?.status).toBe('settled')
    expect(Number(round?.payout)).toBe(72_00)
    expect(round?.detail).toEqual({
      spin,
      bets: [{ spot: '17', amount: 2_00 }],
      number: 17,
      wins: ['17'],
    })
    const [outsideRound] = await roundsOf(outside.id)
    expect(outsideRound?.detail.wins).toEqual(['black'])
    expect(Number(outsideRound?.payout)).toBe(
      Number(settleBets(outsideRound?.detail.bets ?? [], 17).payout),
    )

    const row = await spinRow(spin)
    expect(row?.state).toBe('settled')
    expect(row?.result?.number).toBe(17)
    expect(row?.settled_at).not.toBeNull()
    expect(row?.secret).toBeNull()
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])

    // The number goes out first, then each player's result, the ticker and chat.
    await outside.client.settle()
    const names = capture.events.map((e) => `${e.channel.split(':').slice(-2).join(':')} ${e.name}`)
    expect(names[0]).toBe('room:roulette round.result')
    expect(names.filter((n) => n === 'room:roulette round.settled')).toHaveLength(4)
    expect(names.filter((n) => n.endsWith('feed round.settled'))).toHaveLength(4)
    const posts = capture.events
      .filter((e) => e.name === 'chat.message')
      .map((e) => e.envelope.data as { body: string; meta: { userId: string } })
    expect(posts.map((p) => p.meta.userId).sort()).toEqual([allIn.id, single.id].sort())
    expect(posts.find((p) => p.meta.userId === single.id)?.body).toMatch(/won 70 on Roulette/)
    expect(posts.find((p) => p.meta.userId === allIn.id)?.body).toMatch(
      /went all in on Roulette and lost 30/,
    )

    // A second settle only reads the saved result.
    const again = await settle(everyNumber.client, spin)
    expect(again.body).toEqual(drawn.body)
    expect(await balance(single.id)).toBe(170_00n)
  })

  it('draws one number however many browsers settle at once', async () => {
    const spin = await nextSpin()
    const players = await Promise.all([player(50n), player(50n), player(50n)])
    for (const p of players) expect((await bet(p.client, spin, [['red', '5']])).status).toBe(200)
    await closeSpin(spin)

    const results = await Promise.all(
      players.flatMap((p) => [
        settle(p.client, spin),
        settle(p.client, spin),
        settle(p.client, spin),
      ]),
    )
    const numbers = new Set(
      results.map((r) => {
        expect(r.status, JSON.stringify(r.body)).toBe(200)
        return r.body.state === 'drawn' ? r.body.result.number : -1
      }),
    )
    expect(numbers.size).toBe(1)
    expect(numbers.has(-1)).toBe(false)
    for (const p of players) {
      const payouts = (await ledgerOf(p.id)).filter((l) => l.reason === 'payout')
      expect(payouts.length).toBeLessThanOrEqual(1)
    }
    await Promise.all(players.map((p) => p.client.settle()))
    expect(capture.events.filter((e) => e.name === 'round.result')).toHaveLength(1)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('refuses bets and changes after the close', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(20n)
    expect((await bet(client, spin, [['red', '5']])).status).toBe(200)
    await closeSpin(spin)
    // Every request settles closed spins first, so this one draws it: 1 is red.
    draws.next = [1]

    const late = await bet(client, spin, [['black', '5']])
    expect(late.status).toBe(409)
    expect(late.body.error.code).toBe('spin_closed')
    const remove = await client.post('/api/roulette/remove', { spin, spot: 'red' }, key())
    expect(remove.status).toBe(409)
    expect(remove.body.error.code).toBe('spin_closed')
    const clear = await client.post('/api/roulette/clear', { spin }, key())
    expect(clear.status).toBe(409)
    // Only the bet placed in time rode the spin, and it won.
    expect(await balance(id)).toBe(25_00n)
    const drawn = await settle(client, spin)
    expect(drawn.body.state === 'drawn' && drawn.body.result.number).toBe(1)
  })

  it('does not spin or save anything when nobody bet', async () => {
    const before = await latestSpinRow()
    // The next spin closed a second ago with no bets on it.
    const spin = await nextSpin(BETTING + 1)
    const { client } = await player(10n)
    const res = await settle(client, spin)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ state: 'empty', spin })
    expect(await spinRow(spin)).toBeNull()
    expect((await latestSpinRow())?.id).toBe(before?.id)
  })

  it('settles a spin left behind before taking a bet on the next one', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(20n)
    expect((await bet(client, spin, [['red', '5']])).status).toBe(200)
    // Everyone left before the close: nobody settled it.
    const next = await nextSpin()
    draws.next = [3]
    const res = await bet(client, next, [['black', '5']])
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.round.detail.spin).toBe(next)
    const rounds = await roundsOf(id)
    expect(rounds.map((r) => [r.status, r.detail.number])).toEqual([
      ['settled', 3],
      ['open', null],
    ])
    // 3 is red: 5 on red came back as 10.
    expect(await balance(id)).toBe(20_00n)
  })

  it('lets the daily sweep settle a spin nobody came back for', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(20n)
    expect((await bet(client, spin, [['even', '4']])).status).toBe(200)
    await closeSpin(spin)
    draws.next = [2]
    const publishing: Promise<unknown>[] = []
    expect(await sweepUnsettledSpins((p) => publishing.push(p))).toBe(1)
    await Promise.all(publishing)
    expect(await balance(id)).toBe(24_00n)
    expect(await sweepUnsettledSpins(() => {})).toBe(0)
  })
})

describe('replays, races and hidden things', () => {
  it('answers a replayed request key with the first answer and changes nothing', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(20n)
    const headers = key()
    const body = { spin, bets: [{ spot: 'odd', bet: '3' }] }
    const first = await client.post<Bet>('/api/roulette/bet', body, headers)
    const second = await client.post<Bet>('/api/roulette/bet', body, headers)
    expect(first.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(await balance(id)).toBe(17_00n)
    expect(await ledgerOf(id)).toHaveLength(1)
  })

  it('never lets parallel bets spend the same chips twice', async () => {
    const spin = await nextSpin()
    const { id, client } = await player(10n)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => bet(client, spin, [[i % 2 ? 'red' : '17', '1']])),
    )
    const placed = results.filter((r) => r.status === 200)
    for (const r of results) expect([200, 400], JSON.stringify(r.body)).toContain(r.status)
    expect(placed).toHaveLength(10)
    expect(await balance(id)).toBe(0n)
    const rounds = await roundsOf(id)
    expect(rounds).toHaveLength(1)
    expect(Number(rounds[0]?.stake)).toBe(10_00)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])

    // All in from several tabs at once: one goes through.
    const spin2 = spin
    const { id: rich, client: tabs } = await player(30n)
    const allIns = await Promise.all(
      Array.from({ length: 6 }, () => bet(tabs, spin2, [['black', 'all']])),
    )
    expect(allIns.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await balance(rich)).toBe(0n)
  })

  it('keeps hidden and early things out of every response and event', async () => {
    const spin = await nextSpin()
    const { client } = await player(20n)
    const responses: unknown[] = []
    responses.push((await bet(client, spin, [['5', '2']])).body)
    responses.push((await client.get('/api/roulette/room')).body)
    responses.push((await client.get('/api/roulette/table')).body)
    await client.settle()
    // Before the close, nothing anywhere carries a number for this spin.
    const before = JSON.stringify([...responses, ...capture.events.map((e) => e.envelope)])
    expect(before).not.toContain('"secret"')
    const results = capture.events
      .filter((e) => e.name === 'round.result')
      .map((e) => (e.envelope.data as { result: { spin: number } }).result.spin)
    expect(results).not.toContain(spin)
    for (const e of capture.events.filter((e) => e.channel.endsWith('room:roulette'))) {
      const detail = (e.envelope.data as { detail?: RouletteDetail }).detail
      if (detail?.spin === spin) expect(detail.number).toBeNull()
    }
    expect(JSON.stringify(responses[0])).toContain('"number":null')

    await closeSpin(spin)
    responses.push((await settle(client, spin)).body)
    await client.settle()
    const all = JSON.stringify([...responses, ...capture.events.map((e) => e.envelope)])
    expect(all).not.toContain('"secret"')
  })

  it('refuses requests without a session, with bad input, or without a request key', async () => {
    const spin = await nextSpin()
    const { client } = await player(20n)
    const anonymous = apiClient(rouletteApi)
    expect((await anonymous.get('/api/roulette/table')).status).toBe(401)
    expect(
      (
        await anonymous.post(
          '/api/roulette/bet',
          { spin, bets: [{ spot: 'red', bet: '1' }] },
          key(),
        )
      ).status,
    ).toBe(401)

    const purple = await bet(client, spin, [['purple', '1']])
    expect(purple.status).toBe(400)
    expect(purple.body.error.message).toBe('That is not a place on the table.')
    const noBets = await client.post('/api/roulette/bet', { spin, bets: [] }, key())
    expect(noBets.status).toBe(400)
    expect(noBets.body.error.message).toBe('Place at least one bet.')
    const outcome = await client.post(
      '/api/roulette/bet',
      { spin, bets: [{ spot: 'red', bet: '1' }], number: 17 },
      key(),
    )
    expect(outcome.status).toBe(400)

    const noKey = await client.post('/api/roulette/bet', {
      spin,
      bets: [{ spot: 'red', bet: '1' }],
    })
    expect(noKey.status).toBe(400)
    expect(noKey.body.error.code).toBe('missing_idempotency_key')
  })
})

describe('the room and the table', () => {
  it("shows each seated player's bets, and the wheel's schedule and last numbers", async () => {
    const spin = await nextSpin()
    const a = await player(20n)
    const b = await player(20n)
    expect((await bet(a.client, spin, [['red', '2']])).status).toBe(200)
    expect((await bet(b.client, spin, [['0', '1']])).status).toBe(200)

    const room = await a.client.get<RoomState<RouletteDetail>>('/api/roulette/room')
    expect(room.status).toBe(200)
    const seats = room.body.rounds.filter((r) => r.userId === a.id || r.userId === b.id)
    expect(seats.map((r) => r.detail.bets)).toEqual(
      expect.arrayContaining([[{ spot: 'red', amount: 2_00 }], [{ spot: '0', amount: 1_00 }]]),
    )

    const table = await a.client.get<RouletteTable>('/api/roulette/table')
    expect(table.status).toBe(200)
    expect(table.body.clock?.anchor.spin).toBe(spin)
    expect(table.body.clock?.timing).toEqual({
      bettingMs: BETTING * 1000,
      spinMs: SPIN * 1000,
      resultMs: RESULT * 1000,
    })
    const recent = table.body.recent
    expect(recent.length).toBeGreaterThan(0)
    expect(recent.length).toBeLessThanOrEqual(12)
    const spins = recent.map((r) => r.spin)
    expect(spins).toEqual([...spins].sort((x, y) => y - x))

    await closeSpin(spin)
    draws.next = [0]
    expect((await settle(b.client, spin)).status).toBe(200)
    const after = await a.client.get<RouletteTable>('/api/roulette/table')
    expect(after.body.recent[0]).toMatchObject({ spin, number: 0 })
    // 0 wins 36 for 1, and red loses.
    expect(await balance(b.id)).toBe(55_00n)
    expect(await balance(a.id)).toBe(18_00n)
  })
})
