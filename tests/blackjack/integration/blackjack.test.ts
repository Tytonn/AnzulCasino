/**
 * Blackjack's endpoints against a real database (spec: Quality bar). The
 * shoe deals the cards a test stacks first, then random ones, so each test
 * plays the exact hand it describes through the real endpoints: the stake
 * goes down before the cards, a double or a split takes its stake before its
 * card, the peeked hole card never leaves the server, a replayed request
 * changes nothing, a stale tab cannot move a hand, and idle hands stand.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHIP } from '../../../shared/chips.ts'
import {
  type BlackjackDetail,
  type Card,
  cardValue,
  handTotal,
  isPair,
  legalMoves,
  type Move,
  roundPayout,
} from '../../../shared/games/blackjack.ts'
import type { PlayResult, RoomState, RoundView } from '../../../shared/rounds.ts'
import { blackjackApi } from '../../../server/games/blackjack/api.ts'
import type * as Rules from '../../../server/games/blackjack/rules.ts'
import { changeConfig } from '../../../server/lib/config.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { ledgerMismatches, readWallet } from '../../../server/lib/wallet.ts'
import { apiClient, type ApiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

/** The cards the next draws take, before the shoe goes back to random ones. */
const stacked = vi.hoisted(() => ({ cards: [] as string[] }))

vi.mock('../../../server/games/blackjack/rules.ts', async (importOriginal) => {
  const real = await importOriginal<typeof Rules>()
  class StackedShoe extends real.Shoe {
    override draw(): Card {
      const card = stacked.cards.shift() as Card | undefined
      if (!card) return super.draw()
      this.remove(card)
      return card
    }
  }
  return { ...real, Shoe: StackedShoe }
})

process.env.DATABASE_POOL_MAX = '30'
const testDb = await useTestDatabase()

/** An answer: the hand and the wallet, or a refusal in plain words. */
type Hand = PlayResult<BlackjackDetail> & { error: { code: string; message: string } }
type HandView = RoundView<BlackjackDetail>

let seasonId: number
let capture: { events: Outgoing[]; stop(): void }

beforeAll(async () => {
  seasonId = await createSeason(testDb)
})

beforeEach(async () => {
  capture = captureLive()
  stacked.cards.length = 0
  await testDb.query(`delete from rate_limits`)
})

afterEach(() => {
  capture.stop()
})

const key = () => ({ 'idempotency-key': randomUUID() })

/** The next cards the shoe deals, in order. */
function stack(...cards: Card[]) {
  stacked.cards.push(...cards)
}

async function player(whole: bigint, season = seasonId) {
  const id = await createPlayer(testDb)
  await fundWallet(season, id, whole * CHIP)
  return { id, client: await loggedIn(blackjackApi, id) }
}

function deal(client: ApiClient, bet: string, headers = key()) {
  return client.post<Hand>('/api/blackjack/deal', { bet }, headers)
}

function move(client: ApiClient, round: HandView, which: Move, headers = key()) {
  return client.post<Hand>(
    '/api/blackjack/move',
    { move: which, roundId: round.id, steps: round.steps },
    headers,
  )
}

async function balance(userId: string, season = seasonId): Promise<bigint> {
  const wallet = await readWallet(db(), season, userId)
  if (!wallet) throw new Error('no wallet')
  return wallet.balance
}

async function rounds(userId: string) {
  return testDb.query<{ id: number; status: string; stake: string; secret: unknown }>(
    `select id, status, stake, secret from game_rounds where user_id = $1 order by id`,
    [userId],
  )
}

/** A simple strategy that uses every move: split aces and eights, double 10 and 11, hit to 17. */
function simpleMove(detail: BlackjackDetail): Move {
  const legal = legalMoves(detail)
  const hand = detail.hands[detail.active ?? -1]
  if (!hand) throw new Error('No hand to play')
  const first = hand.cards[0]
  if (legal.includes('split') && isPair(hand.cards) && first && [1, 8].includes(cardValue(first))) {
    return 'split'
  }
  const { total } = handTotal(hand.cards)
  if (legal.includes('double') && (total === 10 || total === 11)) return 'double'
  return total < 17 ? 'hit' : 'stand'
}

function ok(res: { status: number; body: unknown }) {
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

describe('POST /api/blackjack/deal', () => {
  it('takes the stake, then deals two cards each, leaving the hole card undrawn with 2 to 9 up', async () => {
    const { id, client } = await player(100n)
    stack('9s', '7h', '5d')
    const res = await deal(client, '10')
    ok(res)
    expect(res.body.round).toMatchObject({
      game: 'blackjack',
      userId: id,
      status: 'open',
      stake: 10,
      payout: null,
      detail: {
        bet: 10,
        hands: [{ cards: ['9s', '5d'], stake: 10, result: null }],
        dealer: ['7h'],
        active: 0,
        peeked: false,
        slowReveal: false,
      },
    })
    expect(res.body.wallet.balance).toBe(90)
    const [row] = await rounds(id)
    expect(row).toMatchObject({ status: 'open', secret: null })
    expect(stacked.cards).toEqual([])
  })

  it('keeps the peeked hole card in the secret, out of every answer and event, until it turns over', async () => {
    const { id, client } = await player(100n)
    stack('9s', 'Ah', '5d', '9c')
    const dealt = await deal(client, '10')
    ok(dealt)
    expect(dealt.body.round.detail).toMatchObject({ dealer: ['Ah'], peeked: true, active: 0 })
    expect((await rounds(id))[0]?.secret).toEqual({ hole: '9c' })

    await client.settle()
    const room = await client.get<RoomState<BlackjackDetail>>('/api/blackjack/room')
    for (const seen of [dealt.body, room.body, capture.events]) {
      expect(JSON.stringify(seen)).not.toContain('"9c"')
      expect(JSON.stringify(seen)).not.toContain('secret')
    }

    // Standing turns it over: the dealer's ace and nine make a soft 20.
    const stood = await move(client, dealt.body.round, 'stand')
    ok(stood)
    expect(stood.body.round).toMatchObject({
      status: 'settled',
      payout: 0,
      summary: '20 beats 14',
      detail: { dealer: ['Ah', '9c'], active: null },
    })
    expect((await rounds(id))[0]?.secret).toBeNull()
  })

  it('ends the hand at the deal on a dealer blackjack, taking only the bet', async () => {
    const { id, client } = await player(100n)
    stack('9s', 'Kh', '5d', 'Ac')
    const res = await deal(client, '10')
    ok(res)
    expect(res.body.round).toMatchObject({
      status: 'settled',
      payout: 0,
      summary: 'Dealer blackjack',
      detail: { dealer: ['Kh', 'Ac'] },
    })
    expect(await balance(id)).toBe(90n * CHIP)
    expect((await rounds(id))[0]?.secret).toBeNull()
  })

  it('pays a blackjack 3 to 2 at once', async () => {
    const { id, client } = await player(100n)
    stack('As', '6h', 'Kd', 'Tc')
    const res = await deal(client, '10')
    ok(res)
    expect(res.body.round).toMatchObject({ status: 'settled', payout: 25, summary: 'Blackjack' })
    expect(res.body.wallet.balance).toBe(115)
    expect(await balance(id)).toBe(115n * CHIP)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('tells the room the bet, the cards and the result', async () => {
    const { client } = await player(100n)
    stack('Ts', '9h', '7d')
    const dealt = await deal(client, '5')
    stack('Tc')
    ok(await move(client, dealt.body.round, 'stand'))
    await client.settle()
    const room = capture.events
      .filter((e) => e.channel.endsWith('room:blackjack'))
      .map((e) => e.name)
    expect(room).toEqual(['round.started', 'round.action', 'round.settled'])
    const [started, action] = capture.events.filter((e) => e.channel.endsWith('room:blackjack'))
    // The bet is placed before a card exists.
    expect((started?.envelope.data as HandView).detail.hands).toEqual([])
    expect((action?.envelope.data as HandView).detail.hands[0]?.cards).toEqual(['Ts', '7d'])
    const ticker = capture.events.find(
      (e) => e.name === 'round.settled' && !e.channel.includes('room:'),
    )
    expect(ticker?.envelope.data).toMatchObject({ game: 'blackjack', stake: 5, payout: 0 })
  })

  it('needs a session, an idempotency key and an amount', async () => {
    const anonymous = apiClient(blackjackApi)
    expect((await anonymous.post('/api/blackjack/deal', { bet: '1' }, key())).status).toBe(401)
    const { id, client } = await player(10n)
    expect((await client.post('/api/blackjack/deal', { bet: '1' })).status).toBe(400)
    const cases: [unknown, string][] = [
      [{ bet: '' }, 'Type an amount'],
      [{ bet: '11' }, 'You only have 10 chips.'],
      [{ bet: '1', cards: ['As', 'Kd'] }, ''],
    ]
    for (const [body, message] of cases) {
      const res = await client.post('/api/blackjack/deal', body, key())
      expect(res.status, JSON.stringify(res.body)).toBe(400)
      expect(res.body.error.message).toContain(message)
    }
    expect(await rounds(id)).toHaveLength(0)
  })

  it('never deals two hands at once, or spends a chip twice', async () => {
    const { id, client } = await player(10n)
    // A hand that stays open (14 against a 7), so every other deal meets it. Random cards
    // could settle it at the deal, on a dealer blackjack, and free the table for a second
    // hand, after which the rest are refused for the chips left instead.
    stack('9s', '7h', '5d')
    const responses = await Promise.all(Array.from({ length: 8 }, () => deal(client, '4')))
    for (const res of responses.filter((r) => r.status !== 200)) {
      expect(res.status, JSON.stringify(res.body)).toBe(409)
      expect(res.body.error.code).toBe('round_open')
    }
    const all = await rounds(id)
    expect(all.filter((r) => r.status === 'open').length).toBeLessThanOrEqual(1)
    expect(all).toHaveLength(responses.filter((r) => r.status === 200).length)
    expect(await balance(id)).toBeGreaterThanOrEqual(0n)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('posts an all-in to chat and gives it the slow reveal', async () => {
    const { id, client } = await player(10n)
    stack('As', '6h', 'Kd', 'Tc')
    const res = await deal(client, 'all')
    ok(res)
    expect(res.body.round).toMatchObject({
      allIn: true,
      bigBet: true,
      payout: 25,
      detail: { slowReveal: true },
    })
    const [post] = await testDb.query<{ kind: string; body: string }>(
      `select kind, body from chat_messages where meta->>'userId' = $1`,
      [id],
    )
    expect(post?.kind).toBe('system')
    expect(post?.body).toMatch(/went all in on Blackjack and won 15$/)
  })
})

describe('POST /api/blackjack/move', () => {
  it('hits and stands, then the dealer draws to 17 and the hand settles', async () => {
    const { id, client } = await player(100n)
    stack('5s', '9h', '3d')
    const dealt = await deal(client, '10')
    stack('4c')
    const hit = await move(client, dealt.body.round, 'hit')
    ok(hit)
    expect(hit.body.round).toMatchObject({ status: 'open', steps: dealt.body.round.steps + 1 })
    expect(hit.body.round.detail.hands[0]?.cards).toEqual(['5s', '3d', '4c'])

    stack('7c', '5h')
    const stood = await move(client, hit.body.round, 'stand')
    ok(stood)
    expect(stood.body.round).toMatchObject({
      status: 'settled',
      payout: 0,
      summary: '21 beats 12',
      detail: {
        dealer: ['9h', '7c', '5h'],
        moves: [
          { hand: 0, move: 'hit' },
          { hand: 0, move: 'stand' },
        ],
      },
    })
    expect(await balance(id)).toBe(90n * CHIP)
  })

  it('doubles: the second stake goes down, then one card, then the dealer', async () => {
    const { id, client } = await player(100n)
    stack('9s', '6h', '2d')
    const dealt = await deal(client, '10')
    // 9 2 doubles and catches a ten: 21. The dealer's 6 T draws a 9 and busts.
    stack('Tc', 'Th', '9c')
    const doubled = await move(client, dealt.body.round, 'double')
    ok(doubled)
    expect(doubled.body.round).toMatchObject({
      status: 'settled',
      stake: 20,
      payout: 40,
      summary: 'Doubled, dealer bust on 25',
      detail: { hands: [{ cards: ['9s', '2d', 'Tc'], doubled: true, stake: 20 }] },
    })
    expect(doubled.body.wallet.balance).toBe(120)
    const ledger = await testDb.query<{ reason: string; delta: string }>(
      `select reason, delta from ledger where user_id = $1 and reason <> 'season_start' order by id`,
      [id],
    )
    expect(ledger.map((r) => [r.reason, Number(r.delta)])).toEqual([
      ['bet', -10],
      ['bet', -10],
      ['payout', 40],
    ])
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('splits into two hands with a second stake, plays each, and settles each', async () => {
    const { id, client } = await player(100n)
    stack('8s', '6h', '8d')
    const dealt = await deal(client, '10')
    stack('3c')
    const split = await move(client, dealt.body.round, 'split')
    ok(split)
    expect(split.body.round).toMatchObject({ status: 'open', stake: 20 })
    expect(split.body.round.detail.hands.map((h) => h.cards)).toEqual([['8s', '3c'], ['8d']])
    expect(split.body.wallet.balance).toBe(80)

    // Double after the split: 8 3 catches a ten. The second hand gets its king.
    stack('Td', 'Kh')
    const doubled = await move(client, split.body.round, 'double')
    ok(doubled)
    expect(doubled.body.round).toMatchObject({ status: 'open', stake: 30 })
    expect(doubled.body.round.detail).toMatchObject({ active: 1 })
    expect(doubled.body.round.detail.hands.map((h) => h.cards)).toEqual([
      ['8s', '3c', 'Td'],
      ['8d', 'Kh'],
    ])

    stack('9c', '5s')
    const stood = await move(client, doubled.body.round, 'stand')
    ok(stood)
    expect(stood.body.round).toMatchObject({
      status: 'settled',
      stake: 30,
      payout: 40,
      summary: 'Split: won 21 doubled, lost 18',
      detail: { dealer: ['6h', '9c', '5s'] },
    })
    expect(await balance(id)).toBe(110n * CHIP)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('refuses a double or a split the wallet cannot cover, and leaves the hand as it was', async () => {
    const { id, client } = await player(10n)
    stack('8s', '6h', '8d')
    const dealt = await deal(client, '6')
    for (const [which, word] of [
      ['double', 'Doubling'],
      ['split', 'Splitting'],
    ] as const) {
      const res = await move(client, dealt.body.round, which)
      expect(res.status, JSON.stringify(res.body)).toBe(400)
      expect(res.body.error).toMatchObject({
        code: 'insufficient_funds',
        message: `${word} takes another 6 chips, and you have 4 chips.`,
      })
    }
    expect(await balance(id)).toBe(4n * CHIP)
    expect(await rounds(id)).toMatchObject([{ status: 'open', stake: '6' }])
    // The hand plays on.
    stack('Kc')
    ok(await move(client, dealt.body.round, 'stand'))
  })

  it('refuses a move the hand does not allow, in plain words', async () => {
    const { client } = await player(100n)
    expect(
      (await client.post('/api/blackjack/move', { move: 'hit', roundId: 1, steps: 0 }, key())).body
        .error,
    ).toMatchObject({ code: 'no_round' })

    stack('9s', '7h', '5d')
    const dealt = await deal(client, '10')
    const split = await move(client, dealt.body.round, 'split')
    expect(split.status).toBe(400)
    expect(split.body.error).toMatchObject({
      code: 'bad_move',
      message: 'You can only split two cards of the same value.',
    })
    stack('2c')
    const hit = await move(client, dealt.body.round, 'hit')
    const double = await move(client, hit.body.round, 'double')
    expect(double.status).toBe(400)
    expect(double.body.error.message).toBe('You can only double on your first two cards.')
    const surrender = await client.post(
      '/api/blackjack/move',
      { move: 'surrender', roundId: hit.body.round.id, steps: hit.body.round.steps },
      key(),
    )
    expect(surrender.status).toBe(400)
    expect(surrender.body.error.message).toBe('Pick hit, stand, double or split.')
  })

  it('refuses a move from a tab that fell behind, and shows the hand as it is', async () => {
    const { client } = await player(100n)
    stack('5s', '9h', '3d')
    const dealt = await deal(client, '10')
    stack('2c')
    ok(await move(client, dealt.body.round, 'hit'))
    // The old tab still shows the hand before the hit.
    const stale = await move(client, dealt.body.round, 'hit')
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({ code: 'stale_move' })
    const wrongRound = await client.post(
      '/api/blackjack/move',
      { move: 'stand', roundId: dealt.body.round.id + 1_000, steps: dealt.body.round.steps + 1 },
      key(),
    )
    expect(wrongRound.status).toBe(409)
    const room = await client.get<RoomState<BlackjackDetail>>('/api/blackjack/room')
    const mine = room.body.rounds.find((r) => r.id === dealt.body.round.id)
    expect(mine?.detail.hands[0]?.cards).toEqual(['5s', '3d', '2c'])
  })

  it('answers a repeated move with the first answer and draws nothing more', async () => {
    const { client } = await player(100n)
    stack('5s', '9h', '3d')
    const dealt = await deal(client, '10')
    const headers = key()
    stack('2c')
    const first = await move(client, dealt.body.round, 'hit', headers)
    const again = await move(client, dealt.body.round, 'hit', headers)
    ok(first)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(first.body.round.detail.hands[0]?.cards).toEqual(['5s', '3d', '2c'])
  })

  it('takes no double or split once the season has ended, but lets the hand play out', async () => {
    // Only one season runs at a time: park the shared one while this test runs.
    await testDb.query(
      `update seasons set status = 'scheduled', starts_at = now() + interval '400 days',
       ends_at = now() + interval '430 days' where id = $1`,
      [seasonId],
    )
    try {
      const ending = await createSeason(testDb)
      const { id, client } = await player(100n, ending)
      stack('8s', '6h', '8d')
      const dealt = await deal(client, '10')
      ok(dealt)
      await testDb.query(`update seasons set ends_at = now() - interval '1 second' where id = $1`, [
        ending,
      ])
      for (const which of ['double', 'split'] as const) {
        const res = await move(client, dealt.body.round, which)
        expect(res.status, JSON.stringify(res.body)).toBe(409)
        expect(res.body.error.code).toBe('season_over')
      }
      stack('9c', '5s')
      const stood = await move(client, dealt.body.round, 'stand')
      ok(stood)
      expect(stood.body.round).toMatchObject({ status: 'settled', payout: 0 })
      expect(await balance(id, ending)).toBe(90n * CHIP)
    } finally {
      await testDb.query(
        `update seasons set status = 'active', starts_at = now() - interval '1 day',
         ends_at = now() + interval '29 days' where id = $1`,
        [seasonId],
      )
    }
  })
})

describe('the slow reveal', () => {
  it('marks a bet over half the wallet, and a double that takes it over', async () => {
    const half = await player(100n)
    stack('9s', '7h', '2d')
    const even = await deal(half.client, '50')
    expect(even.body.round.detail.slowReveal).toBe(false)

    const over = await player(100n)
    stack('9s', '7h', '2d')
    expect((await deal(over.client, '51')).body.round.detail.slowReveal).toBe(true)

    const doubling = await player(100n)
    stack('9s', '7h', '2d')
    const small = await deal(doubling.client, '40')
    expect(small.body.round.detail.slowReveal).toBe(false)
    stack('5c', 'Tc')
    const doubled = await move(doubling.client, small.body.round, 'double')
    ok(doubled)
    expect(doubled.body.round.detail.slowReveal).toBe(true)
  })

  it('reads its threshold from the config', async () => {
    const admin = await createPlayer(testDb)
    const set = (value: number) =>
      db().transaction((tx) =>
        changeConfig(tx, {
          key: 'blackjack_slow_reveal_pct',
          value,
          actorId: admin,
          now: new Date(),
        }),
      )
    await set(2_000)
    try {
      const { client } = await player(100n)
      stack('9s', '7h', '2d')
      expect((await deal(client, '21')).body.round.detail.slowReveal).toBe(true)
    } finally {
      await set(5_000)
    }
  })
})

describe('GET /api/blackjack/room', () => {
  it("shows each player's hand and nothing hidden", async () => {
    const alice = await player(50n)
    const bob = await player(50n)
    stack('9s', 'Kh', '5d', '7c')
    const alices = await deal(alice.client, '2')
    stack('Ts', '8h', 'Td')
    const bobs = await deal(bob.client, '3')
    const room = await bob.client.get<RoomState<BlackjackDetail>>('/api/blackjack/room')
    expect(room.status).toBe(200)
    const byPlayer = new Map(room.body.rounds.map((r) => [r.userId, r]))
    expect(byPlayer.get(alice.id)).toEqual(alices.body.round)
    expect(byPlayer.get(bob.id)).toEqual(bobs.body.round)
    // Alice's dealer peeked under the king: the seven stays on the server.
    expect(JSON.stringify(byPlayer.get(alice.id))).not.toContain('"7c"')
  })

  it('stands a hand left idle, and the dealer plays it out', async () => {
    const { id, client } = await player(100n)
    stack('Ts', '9h', '6d')
    const dealt = await deal(client, '10')
    await testDb.query(
      `update game_rounds set acted_at = now() - interval '2 hours' where id = $1`,
      [dealt.body.round.id],
    )
    stack('Tc')
    const room = await client.get<RoomState<BlackjackDetail>>('/api/blackjack/room')
    const mine = room.body.rounds.find((r) => r.id === dealt.body.round.id)
    expect(mine).toMatchObject({
      status: 'settled',
      payout: 0,
      summary: '19 beats 16 (stood for an idle hand)',
      detail: { idle: true, dealer: ['9h', 'Tc'] },
    })
    expect(await balance(id)).toBe(90n * CHIP)
  })
})

describe('a session of real hands', () => {
  it('plays 40 random hands, and every chip adds up', async () => {
    const { id, client } = await player(1_000n)
    let expected = 1_000n * CHIP
    for (let i = 0; i < 40; i++) {
      let res = await deal(client, '5')
      ok(res)
      while (res.body.round.status === 'open') {
        res = await move(client, res.body.round, simpleMove(res.body.round.detail))
        ok(res)
      }
      const { round } = res.body
      expect(BigInt(round.payout ?? 0)).toBe(roundPayout(round.detail))
      expect(round.stake).toBe(round.detail.hands.reduce((sum, h) => sum + h.stake, 0))
      expected += BigInt((round.payout ?? 0) - round.stake)
      expect(BigInt(res.body.wallet.balance)).toBe(expected)
    }
    expect(await balance(id)).toBe(expected)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
    const open = await testDb.query(
      `select id from game_rounds where user_id = $1 and (status = 'open' or secret is not null)`,
      [id],
    )
    expect(open).toHaveLength(0)
  })
})
