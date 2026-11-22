/**
 * Roulette's endpoints against a real database (spec: Games > Roulette and
 * the Quality bar). There is no clock: the first bet opens a round with one
 * card for everyone, every bet while it is open joins it and starts its
 * countdown again (never past its limit from the first bet), and the first
 * request after the close draws the number and pays every bet in one
 * transaction. A bet after the close settles the old round and opens the
 * next, there is never more than one open round, replays change nothing,
 * parallel requests cannot overdraw or draw twice, and nothing hidden or
 * early leaves the server.
 *
 * The tests move a round's times instead of waiting: a round closes 120
 * seconds after its latest bet and at most 600 after its first, and a test
 * closes one by moving its close into the past. Before each test, whatever
 * round the last one left open is closed and swept, so each starts afresh.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatMessage, StreamPage } from '../../../shared/chat.ts'
import { CHIP } from '../../../shared/chips.ts'
import {
  type RouletteBetResult,
  type RouletteTable,
  type SettleResponse,
  settleBets,
  tablePlayers,
} from '../../../shared/games/roulette.ts'
import { coreApi } from '../../../server/core/api.ts'
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

/** A refusal's body; a 200 has none. */
type Refusal = { error: { code: string; message: string } }
type Bet = RouletteBetResult & Refusal

const CLOSE_AFTER = 120
const MAX_OPEN = 600

let seasonId: number
let capture: { events: Outgoing[]; stop(): void }

beforeAll(async () => {
  seasonId = await createSeason(testDb)
  // Long countdowns, so no test races the close. The bets here count single
  // chips, so the smallest bet is 1 instead of the default 25.
  for (const [key, value] of [
    ['roulette_close_after_seconds', CLOSE_AFTER],
    ['roulette_max_open_seconds', MAX_OPEN],
    ['min_bet', 1],
  ] as const) {
    await testDb.query(
      `insert into config (key, value, effective_at) values ($1, $2::jsonb, now() - interval '1 hour')`,
      [key, JSON.stringify(value)],
    )
  }
})

beforeEach(async () => {
  draws.next = []
  await testDb.query(`delete from rate_limits`)
  // Close and pay whatever round the last test left open.
  await testDb.query(
    `update shared_rounds set opens_at = least(opens_at, now() - interval '2 seconds'),
       closes_at = now() - interval '1 second' where settled_at is null`,
  )
  const publishing: Promise<unknown>[] = []
  await sweepUnsettledSpins((p) => publishing.push(p))
  await Promise.all(publishing)
  capture = captureLive()
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
type Player = Awaited<ReturnType<typeof player>>

async function balance(userId: string): Promise<bigint> {
  const wallet = await readWallet(db(), seasonId, userId)
  if (!wallet) throw new Error('no wallet')
  return wallet.balance
}

const bet = (client: Player['client'], bets: [string, string][]) =>
  client.post<Bet>(
    '/api/roulette/bet',
    { bets: bets.map(([spot, b]) => ({ spot, bet: b })) },
    key(),
  )

const settle = (client: Player['client'], table: number) =>
  client.post<SettleResponse & Refusal>('/api/roulette/settle', { table }, key())

/** Closes a round's betting a second ago: the wheel is spinning. */
async function closeRound(id: number): Promise<void> {
  await testDb.query(
    `update shared_rounds set opens_at = least(opens_at, now() - interval '2 seconds'),
       closes_at = now() - interval '1 second' where id = $1`,
    [id],
  )
}

async function roundRow(id: number) {
  const [row] = await testDb.query<{
    state: string
    result: { number: number | null } | null
    secret: unknown
    settled_at: Date | null
    opens_at: Date
    closes_at: Date
  }>(
    `select state, result, secret, settled_at, opens_at, closes_at from shared_rounds where id = $1`,
    [id],
  )
  return row ?? null
}

async function openRounds(): Promise<number> {
  const [row] = await testDb.query<{ n: number }>(
    `select count(*)::int as n from shared_rounds
     where season_id = $1 and game = 'roulette' and settled_at is null`,
    [seasonId],
  )
  return row?.n ?? 0
}

async function cardsFor(id: number): Promise<number> {
  const [row] = await testDb.query<{ n: number }>(
    `select count(*)::int as n from chat_messages where kind = 'card' and meta->>'sharedRoundId' = $1`,
    [String(id)],
  )
  return row?.n ?? 0
}

async function roundsOf(userId: string) {
  return testDb.query<{
    status: string
    stake: string
    payout: string | null
    detail: { spin: number; bets: { spot: string; amount: number }[]; number: number | null }
    shared_round_id: string | null
  }>(
    `select status, stake, payout, detail, shared_round_id from game_rounds where user_id = $1 order by id`,
    [userId],
  )
}

async function ledgerOf(userId: string) {
  return testDb.query<{ reason: string; amount: string }>(
    `select reason, delta as amount from ledger where user_id = $1 and reason <> 'season_start' order by id`,
    [userId],
  )
}

/** The live events sent so far, as "room:roulette shared.updated". */
function sent(): string[] {
  return capture.events.map((e) => `${e.channel.split(':').slice(-2).join(':')} ${e.name}`)
}

function sharedUpdates(): RouletteTable[] {
  return capture.events
    .filter((e) => e.name === 'shared.updated')
    .map((e) => e.envelope.data as RouletteTable)
}

const ms = (iso: string) => Date.parse(iso)

describe('a round on the wheel', () => {
  it('opens with the first bet, with one card for everyone, and closes after the latest', async () => {
    const alice = await player(100n)
    const bob = await player(100n)

    const first = await bet(alice.client, [
      ['red', '10'],
      ['17', '2'],
    ])
    expect(first.status, JSON.stringify(first.body)).toBe(200)
    const table = first.body.table
    expect(table.game).toBe('roulette')
    expect(table.state).toBe('betting')
    expect(table.settledAt).toBeNull()
    expect(table.result).toEqual({ number: null })
    expect(ms(table.closesAt) - ms(table.opensAt)).toBe(CLOSE_AFTER * 1000)
    expect(table.rounds).toHaveLength(1)
    expect(table.rounds[0]).toMatchObject({ userId: alice.id, status: 'open', stake: 12 })
    expect(first.body.round.detail).toEqual({
      spin: table.roundNo,
      bets: [
        { spot: 'red', amount: 10 },
        { spot: '17', amount: 2 },
      ],
      number: null,
      wins: [],
    })
    expect(first.body.wallet.balance).toBe(88)
    // The round's one card is everyone's: no player of its own.
    expect(first.body.card).toMatchObject({
      kind: 'card',
      userId: null,
      body: `Roulette · Round ${table.roundNo}`,
      meta: { game: 'roulette', sharedRoundId: table.id },
      sharedRound: { id: table.id },
    })
    // One ledger row opens the player's round, and one more raises it.
    expect((await ledgerOf(alice.id)).map((l) => [l.reason, Number(l.amount)])).toEqual([
      ['bet', -10],
      ['bet', -2],
    ])
    await alice.client.settle()
    // Everyone hears of the new round through its card.
    expect(sent()).toContain('chat chat.message')
    expect(sent()).not.toContain('room:roulette shared.updated')
    const posted = capture.events.find((e) => e.name === 'chat.message')?.envelope
      .data as ChatMessage
    expect(posted.sharedRound?.id).toBe(table.id)

    // Bob's bet joins it and starts the countdown again; the room hears it.
    await testDb.query(
      `update shared_rounds set opens_at = opens_at - interval '100 seconds',
         closes_at = now() + interval '20 seconds' where id = $1`,
      [table.id],
    )
    const joined = await bet(bob.client, [['black', '5']])
    expect(joined.status, JSON.stringify(joined.body)).toBe(200)
    expect(joined.body.table.id).toBe(table.id)
    expect(joined.body.card.id).toBe(first.body.card.id)
    expect(joined.body.table.rounds.map((r) => r.userId)).toEqual([alice.id, bob.id])
    const row = await roundRow(table.id)
    const left = (row?.closes_at.getTime() ?? 0) - Date.now()
    expect(left).toBeGreaterThan((CLOSE_AFTER - 10) * 1000)
    expect(left).toBeLessThanOrEqual(CLOSE_AFTER * 1000 + 1000)
    await bob.client.settle()
    const updates = sharedUpdates()
    expect(updates).toHaveLength(1)
    expect(updates[0]?.rounds).toHaveLength(2)
    expect(updates[0]?.version).toBeGreaterThan(table.version)

    // Alice bets again: her one round on it grows.
    const more = await bet(alice.client, [['red', '5']])
    expect(more.body.round.id).toBe(first.body.round.id)
    expect(more.body.round.detail.bets).toEqual([
      { spot: 'red', amount: 15 },
      { spot: '17', amount: 2 },
    ])
    expect(more.body.table.rounds).toHaveLength(2)
    expect(await roundsOf(alice.id)).toHaveLength(1)
    expect(await openRounds()).toBe(1)
    expect(await cardsFor(table.id)).toBe(1)
  })

  it('never runs past its limit from the first bet', async () => {
    const alice = await player(100n)
    const bob = await player(100n)
    const opened = await bet(alice.client, [['red', '1']])
    const id = opened.body.table.id
    // The round has run ten seconds short of its limit, with five left on the clock.
    await testDb.query(
      `update shared_rounds set opens_at = now() - make_interval(secs => $2),
         closes_at = now() + interval '5 seconds' where id = $1`,
      [id, MAX_OPEN - 10],
    )
    const late = await bet(bob.client, [['black', '1']])
    expect(late.status, JSON.stringify(late.body)).toBe(200)
    expect(late.body.table.id).toBe(id)
    const { opensAt, closesAt } = late.body.table
    expect(Math.abs(ms(closesAt) - ms(opensAt) - MAX_OPEN * 1000)).toBeLessThanOrEqual(1)
    // Another bet joins, and adds no time.
    const again = await bet(alice.client, [['odd', '1']])
    expect(again.body.table.closesAt).toBe(closesAt)
  })

  it('draws only after betting closes, and pays every bet in one transaction', async () => {
    const everyNumber = await player(100n)
    const outside = await player(100n)
    const single = await player(100n)
    const allIn = await player(30n)

    // 1 chip on each of the 37 numbers; red and black; 2 on 17; everything on 1.
    const numbers: [string, string][] = Array.from({ length: 37 }, (_, n) => [String(n), '1'])
    const opened = await bet(everyNumber.client, numbers)
    expect(opened.status, JSON.stringify(opened.body)).toBe(200)
    const id = opened.body.table.id
    expect(
      (
        await bet(outside.client, [
          ['red', '10'],
          ['black', '10'],
        ])
      ).status,
    ).toBe(200)
    expect((await bet(single.client, [['17', '2']])).status).toBe(200)
    expect((await bet(allIn.client, [['1', 'all']])).status).toBe(200)

    // Before the close there is nothing to draw.
    const early = await settle(single.client, id)
    expect(early.status, JSON.stringify(early.body)).toBe(200)
    expect(early.body.state).toBe('open')
    expect(early.body.table.result?.number).toBeNull()
    expect(early.body.table.rounds.every((r) => r.payout === null)).toBe(true)

    await closeRound(id)
    capture.events.length = 0
    draws.next = [17]
    const drawn = await settle(outside.client, id)
    expect(drawn.status, JSON.stringify(drawn.body)).toBe(200)
    expect(drawn.body.state).toBe('drawn')
    expect(drawn.body.table.result?.number).toBe(17)
    expect(drawn.body.table.settledAt).not.toBeNull()
    expect(drawn.body.table.rounds.every((r) => r.status === 'settled')).toBe(true)

    // 17 is black: every number pays 36 of the 37 chips, black doubles,
    // the single number pays 36 times, and the all-in on 1 loses.
    expect(await balance(everyNumber.id)).toBe(99n)
    expect(await balance(outside.id)).toBe(100n)
    expect(await balance(single.id)).toBe(170n)
    expect(await balance(allIn.id)).toBe(0n)
    // The result lists the winners first.
    expect(tablePlayers(drawn.body.table).map((p) => [p.userId, p.net])).toEqual([
      [single.id, 70],
      [outside.id, 0],
      [everyNumber.id, -1],
      [allIn.id, -30],
    ])

    const [round] = await roundsOf(single.id)
    expect(round?.status).toBe('settled')
    expect(Number(round?.payout)).toBe(72)
    expect(round?.detail).toEqual({
      spin: opened.body.table.roundNo,
      bets: [{ spot: '17', amount: 2 }],
      number: 17,
      wins: ['17'],
    })
    const [outsideRound] = await roundsOf(outside.id)
    expect(Number(outsideRound?.payout)).toBe(
      Number(settleBets(outsideRound?.detail.bets ?? [], 17).payout),
    )

    const row = await roundRow(id)
    expect(row?.state).toBe('settled')
    expect(row?.result).toEqual({ number: 17 })
    expect(row?.secret).toBeNull()
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])

    // The card hears the number with everyone's result, then the feed and chat.
    await outside.client.settle()
    const updates = sharedUpdates()
    expect(updates).toHaveLength(1)
    expect(updates[0]?.result?.number).toBe(17)
    expect(updates[0]?.rounds.every((r) => r.status === 'settled')).toBe(true)
    expect(sent().filter((n) => n.endsWith('feed round.settled'))).toHaveLength(4)
    const posts = capture.events
      .filter((e) => e.name === 'chat.message')
      .map((e) => e.envelope.data as { body: string; meta: { userId: string } })
    expect(posts.map((p) => p.meta.userId).sort()).toEqual([allIn.id, single.id].sort())
    expect(posts.find((p) => p.meta.userId === single.id)?.body).toMatch(/won 70 on Roulette/)
    expect(posts.find((p) => p.meta.userId === allIn.id)?.body).toMatch(
      /went all in on Roulette and lost 30/,
    )

    // A second settle only reads the saved result.
    const again = await settle(everyNumber.client, id)
    expect(again.body).toEqual(drawn.body)
    expect(await balance(single.id)).toBe(170n)
  })

  it('draws one number however many browsers settle at once', async () => {
    const players = await Promise.all([player(50n), player(50n), player(50n)])
    let id = 0
    for (const p of players) {
      const placed = await bet(p.client, [['red', '5']])
      expect(placed.status).toBe(200)
      id = placed.body.table.id
    }
    await closeRound(id)

    const results = await Promise.all(
      players.flatMap((p) => [settle(p.client, id), settle(p.client, id), settle(p.client, id)]),
    )
    const numbers = new Set(
      results.map((r) => {
        expect(r.status, JSON.stringify(r.body)).toBe(200)
        return r.body.state === 'drawn' ? r.body.table.result?.number : -1
      }),
    )
    expect(numbers.size).toBe(1)
    expect(numbers.has(-1)).toBe(false)
    for (const p of players) {
      const payouts = (await ledgerOf(p.id)).filter((l) => l.reason === 'payout')
      expect(payouts.length).toBeLessThanOrEqual(1)
    }
    await Promise.all(players.map((p) => p.client.settle()))
    expect(sharedUpdates().filter((t) => t.settledAt !== null)).toHaveLength(1)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('opens the next round with a bet after the close, paying the last one first', async () => {
    const { id, client } = await player(20n)
    const first = await bet(client, [['red', '5']])
    expect(first.status).toBe(200)
    const old = first.body.table
    // Everyone left before the close: nobody settled it. 3 is red.
    await closeRound(old.id)
    draws.next = [3]
    const next = await bet(client, [['black', '5']])
    expect(next.status, JSON.stringify(next.body)).toBe(200)
    expect(next.body.table.id).not.toBe(old.id)
    expect(next.body.table.roundNo).toBe(old.roundNo + 1)
    expect(next.body.table.rounds).toHaveLength(1)
    expect(next.body.card.id).not.toBe(first.body.card.id)
    expect(next.body.round.detail.spin).toBe(old.roundNo + 1)
    expect((await roundsOf(id)).map((r) => [r.status, r.detail.number])).toEqual([
      ['settled', 3],
      ['open', null],
    ])
    // 5 on red came back as 10, and 5 went on black.
    expect(await balance(id)).toBe(20n)
    expect(next.body.wallet.balance).toBe(20)
    expect(await openRounds()).toBe(1)
    expect((await roundRow(old.id))?.result?.number).toBe(3)
  })

  it('opens one round when first bets come at once', async () => {
    const players = await Promise.all(Array.from({ length: 6 }, () => player(20n)))
    const results = await Promise.all(players.map((p) => bet(p.client, [['even', '2']])))
    for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(200)
    const ids = new Set(results.map((r) => r.body.table.id))
    expect(ids.size).toBe(1)
    const [id] = [...ids]
    expect(await openRounds()).toBe(1)
    expect(await cardsFor(id ?? 0)).toBe(1)
    const last = results.reduce((a, b) => (a.body.table.version >= b.body.table.version ? a : b))
    expect(last.body.table.rounds).toHaveLength(6)
  })

  it('lets the daily sweep settle a round nobody came back for', async () => {
    const { id, client } = await player(20n)
    const placed = await bet(client, [['even', '4']])
    await closeRound(placed.body.table.id)
    draws.next = [2]
    const publishing: Promise<unknown>[] = []
    expect(await sweepUnsettledSpins((p) => publishing.push(p))).toBe(1)
    await Promise.all(publishing)
    expect(await balance(id)).toBe(24n)
    expect(await sweepUnsettledSpins(() => {})).toBe(0)
    expect(await openRounds()).toBe(0)
  })

  it('answers a settle for a round that is not there with a 404', async () => {
    const { client } = await player(10n)
    const missing = await settle(client, 987_654)
    expect(missing.status).toBe(404)
    expect(missing.body.error.message).toBe('There is no roulette round like that.')
  })
})

describe('placing bets', () => {
  it('resolves typed amounts in order: "all" after "10" bets the rest', async () => {
    const { id, client } = await player(50n)
    const res = await bet(client, [
      ['black', '10'],
      ['red', 'all'],
    ])
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.round.detail.bets).toEqual([
      { spot: 'black', amount: 10 },
      { spot: 'red', amount: 40 },
    ])
    expect(res.body.round.allIn).toBe(true)
    expect(await balance(id)).toBe(0n)
  })

  it('refuses bets outside the limits, in plain words, and opens nothing for them', async () => {
    const { id, client } = await player(20n)
    const tiny = await bet(client, [['red', '0.5']])
    expect(tiny.status).toBe(400)
    expect(tiny.body.error.message).toBe('The smallest bet is 1.')
    const tooMuch = await bet(client, [
      ['red', '15'],
      ['black', '15'],
    ])
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error.message).toBe('Black: You only have 5 chips.')
    // Nothing went down from the refused requests, and no round opened.
    expect(await balance(id)).toBe(20n)
    expect(await roundsOf(id)).toHaveLength(0)
    expect(await openRounds()).toBe(0)

    const { client: broke } = await player(0n)
    const empty = await bet(broke, [['red', 'all']])
    expect(empty.status).toBe(400)
    expect(empty.body.error.message).toBe('Your wallet is empty.')
  })
})

describe('replays, races and hidden things', () => {
  it('answers a replayed request key with the first answer and changes nothing', async () => {
    const { id, client } = await player(20n)
    const headers = key()
    const body = { bets: [{ spot: 'odd', bet: '3' }] }
    const first = await client.post<Bet>('/api/roulette/bet', body, headers)
    const second = await client.post<Bet>('/api/roulette/bet', body, headers)
    expect(first.status).toBe(200)
    expect(second.body).toEqual(first.body)
    expect(await balance(id)).toBe(17n)
    expect(await ledgerOf(id)).toHaveLength(1)
  })

  it('never lets parallel bets spend the same chips twice', async () => {
    const { id, client } = await player(10n)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => bet(client, [[i % 2 ? 'red' : '17', '1']])),
    )
    for (const r of results) expect([200, 400], JSON.stringify(r.body)).toContain(r.status)
    expect(results.filter((r) => r.status === 200)).toHaveLength(10)
    expect(await balance(id)).toBe(0n)
    const rounds = await roundsOf(id)
    expect(rounds).toHaveLength(1)
    expect(Number(rounds[0]?.stake)).toBe(10)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])

    // All in from several tabs at once: one goes through.
    const { id: rich, client: tabs } = await player(30n)
    const allIns = await Promise.all(Array.from({ length: 6 }, () => bet(tabs, [['black', 'all']])))
    expect(allIns.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await balance(rich)).toBe(0n)
  })

  it('keeps hidden and early things out of every response and event', async () => {
    const { client } = await player(20n)
    const responses: unknown[] = []
    const placed = await bet(client, [['5', '2']])
    responses.push(placed.body)
    const id = placed.body.table.id
    responses.push((await settle(client, id)).body)
    await client.settle()
    // Before the close, nothing anywhere carries a number for this round.
    const before = JSON.stringify([...responses, ...capture.events.map((e) => e.envelope)])
    expect(before).not.toContain('"secret"')
    expect(before).not.toMatch(/"number":\d/)

    await closeRound(id)
    responses.push((await settle(client, id)).body)
    await client.settle()
    const all = JSON.stringify([...responses, ...capture.events.map((e) => e.envelope)])
    expect(all).not.toContain('"secret"')
    expect(all).toMatch(/"number":\d/)
  })

  it('refuses requests without a session, with bad input, or without a request key', async () => {
    const { client } = await player(20n)
    const anonymous = apiClient(rouletteApi)
    expect(
      (await anonymous.post('/api/roulette/bet', { bets: [{ spot: 'red', bet: '1' }] }, key()))
        .status,
    ).toBe(401)
    expect((await anonymous.post('/api/roulette/settle', { table: 1 }, key())).status).toBe(401)

    const purple = await bet(client, [['purple', '1']])
    expect(purple.status).toBe(400)
    expect(purple.body.error.message).toBe('That is not a place on the table.')
    const noBets = await client.post<Refusal>('/api/roulette/bet', { bets: [] }, key())
    expect(noBets.status).toBe(400)
    expect(noBets.body.error.message).toBe('Place at least one bet.')
    // A bet names no round and no outcome: the server picks both.
    for (const extra of [{ spin: 4 }, { number: 17 }]) {
      const res = await client.post(
        '/api/roulette/bet',
        { bets: [{ spot: 'red', bet: '1' }], ...extra },
        key(),
      )
      expect(res.status).toBe(400)
    }
    const noKey = await client.post<Refusal>('/api/roulette/bet', {
      bets: [{ spot: 'red', bet: '1' }],
    })
    expect(noKey.status).toBe(400)
    expect(noKey.body.error.code).toBe('missing_idempotency_key')
    expect(await openRounds()).toBe(0)
  })
})

describe('the stream', () => {
  it('shows the round on its card as it is now, and pins it for its bettors', async () => {
    const alice = await player(20n)
    const bob = await player(20n)
    const placed = await bet(alice.client, [['red', '2']])
    const id = placed.body.table.id
    const aliceStream = await loggedIn(coreApi, alice.id)
    const bobStream = await loggedIn(coreApi, bob.id)

    const page = await aliceStream.get<StreamPage>('/api/stream?filter=games')
    expect(page.status).toBe(200)
    const card = page.body.items.find((m) => m.id === placed.body.card.id)
    expect(card?.sharedRound).toMatchObject({ id, settledAt: null })
    expect(card?.sharedRound?.rounds.map((r) => r.userId)).toEqual([alice.id])
    // Alice has a bet on it, so it comes back among her open cards; not Bob's.
    expect(page.body.mine.map((m) => m.id)).toContain(placed.body.card.id)
    const bobs = await bobStream.get<StreamPage>('/api/stream')
    expect(bobs.body.mine.map((m) => m.id)).not.toContain(placed.body.card.id)
    // Bob joins: now it is his too, with both bets on it.
    expect((await bet(bob.client, [['black', '3']])).status).toBe(200)
    const joined = await bobStream.get<StreamPage>('/api/stream')
    const mine = joined.body.mine.find((m) => m.id === placed.body.card.id)
    expect(mine?.sharedRound?.rounds).toHaveLength(2)

    await closeRound(id)
    draws.next = [32]
    expect((await settle(bob.client, id)).status).toBe(200)
    const after = await aliceStream.get<StreamPage>('/api/stream')
    const settled = after.body.items.find((m) => m.id === placed.body.card.id)
    expect(settled?.sharedRound).toMatchObject({ id, result: { number: 32 } })
    expect(settled?.sharedRound?.settledAt).not.toBeNull()
    expect(after.body.mine.map((m) => m.id)).not.toContain(placed.body.card.id)
    expect(JSON.stringify(after.body)).not.toContain('"secret"')
    // 32 is red: Alice's 2 came back as 4, and Bob's 3 on black lost.
    expect(await balance(alice.id)).toBe(22n)
    expect(await balance(bob.id)).toBe(17n)
  })
})
