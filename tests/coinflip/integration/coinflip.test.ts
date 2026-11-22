/**
 * Coin flip's endpoints against a real database (spec: Quality bar): one
 * request bets and flips, payouts match the call, the room and the ticker
 * hear about it, a replayed request changes nothing, parallel bets cannot
 * overdraw, nothing hidden leaves the server, and all-ins reach chat.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { CHIP } from '../../../shared/chips.ts'
import { type CoinflipDetail, SIDE_NAMES, SIDES } from '../../../shared/games/coinflip.ts'
import type { PlayResult, RoomState } from '../../../shared/rounds.ts'
import { coinflipApi } from '../../../server/games/coinflip/api.ts'
import { changeConfig } from '../../../server/lib/config.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { ledgerMismatches, readWallet } from '../../../server/lib/wallet.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

process.env.DATABASE_POOL_MAX = '30'
const testDb = await useTestDatabase()

type Flip = PlayResult<CoinflipDetail>

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

async function player(whole: bigint) {
  const id = await createPlayer(testDb)
  await fundWallet(seasonId, id, whole * CHIP)
  return { id, client: await loggedIn(coinflipApi, id) }
}

async function balance(userId: string): Promise<bigint> {
  const wallet = await readWallet(db(), seasonId, userId)
  if (!wallet) throw new Error('no wallet')
  return wallet.balance
}

async function rounds(userId: string) {
  return testDb.query<{
    id: number
    status: string
    stake: string
    payout: string
    secret: unknown
  }>(`select id, status, stake, payout, secret from game_rounds where user_id = $1 order by id`, [
    userId,
  ])
}

describe('POST /api/coinflip/play', () => {
  it('bets and flips in one request, paying 1.96x for a right call and nothing for a wrong one', async () => {
    const { id, client } = await player(10_000n)
    const outcomes = new Set<boolean>()
    let expected = 10_000n * CHIP
    // Flip until both a win and a loss have been seen (each flip is 50/50).
    for (let i = 0; i < 60 && outcomes.size < 2; i++) {
      const call = SIDES[i % 2] as (typeof SIDES)[number]
      const res = await client.post<Flip>('/api/coinflip/play', { bet: '25', call }, key())
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const { round, wallet } = res.body
      const face = round.detail.face
      if (!face) throw new Error('the coin did not land')
      const won = face === call
      outcomes.add(won)
      expect(round).toMatchObject({
        game: 'coinflip',
        userId: id,
        status: 'settled',
        stake: 25,
        payout: won ? 49 : 0,
        multiplier: won ? 196 : 0,
        summary: SIDE_NAMES[face],
        detail: { call, face, edgePct: 200 },
      })
      expected += BigInt((round.payout ?? 0) - round.stake)
      expect(BigInt(wallet.balance)).toBe(expected)
    }
    expect(outcomes).toEqual(new Set([true, false]))
    expect(await balance(id)).toBe(expected)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('rounds a win down to a whole chip: 1.96x of 1 chip pays the 1 back', async () => {
    const { id, client } = await player(100n)
    let win: Flip | null = null
    for (let i = 0; i < 40 && !win; i++) {
      const res = await client.post<Flip>('/api/coinflip/play', { bet: '1', call: 'heads' }, key())
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      if (res.body.round.detail.face === 'heads') win = res.body
    }
    expect(win?.round).toMatchObject({ stake: 1, payout: 1, multiplier: 100 })
    // Even: no chat post, and the ledger still adds up.
    const posts = await testDb.query(`select id from chat_messages where meta->>'userId' = $1`, [
      id,
    ])
    expect(posts).toHaveLength(0)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('tells the room, the ticker and the top bar, and nothing hidden leaves the server', async () => {
    const { id, client } = await player(100n)
    const res = await client.post<Flip>('/api/coinflip/play', { bet: '5', call: 'tails' }, key())
    expect(res.status).toBe(200)
    await client.settle()

    const names = capture.events.map(
      (e) => `${e.channel.replace(/^.*?(room|feed|user)/, '$1')} ${e.name}`,
    )
    expect(names).toEqual(
      expect.arrayContaining(['room:coinflip round.started', 'room:coinflip round.settled']),
    )
    const started = capture.events.find((e) => e.name === 'round.started')
    // The coin has not landed when the bet is placed.
    expect((started?.envelope.data as { detail: CoinflipDetail }).detail).toEqual({
      call: 'tails',
      face: null,
      edgePct: 200,
    })
    const ticker = capture.events.find(
      (e) => e.name === 'round.settled' && !e.channel.includes('room:'),
    )
    expect(ticker?.envelope.data).toMatchObject({ userId: id, game: 'coinflip', stake: 5 })
    // One wallet update, after the payout.
    const wallets = capture.events.filter((e) => e.name === 'wallet.updated')
    expect(wallets).toHaveLength(1)
    expect(wallets[0]?.envelope.data).toMatchObject({ balance: res.body.wallet.balance })

    // No secret column, in the answer or in any event.
    expect(JSON.stringify(res.body)).not.toContain('secret')
    expect(JSON.stringify(capture.events)).not.toContain('secret')
    const [row] = await rounds(id)
    expect(row).toMatchObject({ status: 'settled', secret: null })
  })

  it('answers a repeated request with the first answer and changes nothing', async () => {
    const { id, client } = await player(100n)
    const headers = key()
    const first = await client.post<Flip>(
      '/api/coinflip/play',
      { bet: '10', call: 'heads' },
      headers,
    )
    const again = await client.post<Flip>(
      '/api/coinflip/play',
      { bet: '10', call: 'heads' },
      headers,
    )
    expect(first.status).toBe(200)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(first.body)
    expect(await rounds(id)).toHaveLength(1)
    expect(await balance(id)).toBe(BigInt(first.body.wallet.balance))
  })

  it('never overdraws when bets arrive at once', async () => {
    const { id, client } = await player(10n)
    const responses = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        client.post<Flip>('/api/coinflip/play', { bet: 'all', call: SIDES[i % 2] }, key()),
      ),
    )
    const placed = responses.filter((r) => r.status === 200)
    for (const res of responses) {
      expect([200, 400], JSON.stringify(res.body)).toContain(res.status)
      if (res.status === 400) expect((res.body as any).error.code).toBe('bad_bet')
    }
    expect(placed.length).toBeGreaterThan(0)
    expect(await rounds(id)).toHaveLength(placed.length)
    const final = await balance(id)
    expect(final).toBeGreaterThanOrEqual(0n)
    // Each "all" bet staked the whole wallet at its moment: the chain of
    // answers adds up to the final balance.
    const net = placed.reduce((sum, r) => sum + (r.body.round.payout ?? 0) - r.body.round.stake, 0)
    expect(final).toBe(10n * CHIP + BigInt(net))
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('refuses a bad call, a bad amount and more than the wallet, in plain words', async () => {
    const { id, client } = await player(10n)
    const cases: [unknown, string][] = [
      [{ bet: '1', call: 'edge' }, 'Call heads or tails.'],
      [{ bet: 'lots', call: 'heads' }, '"lots" is not an amount. Try 50, 2.5k, half or all.'],
      [{ bet: '11', call: 'heads' }, 'You only have 10 chips.'],
      [{ bet: '0.5', call: 'heads' }, 'The smallest bet is 1.'],
      [{ bet: '1', call: 'heads', face: 'heads' }, ''],
    ]
    for (const [body, message] of cases) {
      const res = await client.post('/api/coinflip/play', body, key())
      expect(res.status, JSON.stringify(res.body)).toBe(400)
      expect(res.body.error.message).toContain(message)
    }
    expect(await rounds(id)).toHaveLength(0)
    expect(await balance(id)).toBe(10n * CHIP)
  })

  it('needs a session and an idempotency key', async () => {
    const anonymous = (await import('../../helpers/api.ts')).apiClient(coinflipApi)
    expect(
      (await anonymous.post('/api/coinflip/play', { bet: '1', call: 'heads' }, key())).status,
    ).toBe(401)
    const { client } = await player(10n)
    const missing = await client.post('/api/coinflip/play', { bet: '1', call: 'heads' })
    expect(missing.status).toBe(400)
  })

  it('posts an all-in to chat, win or lose', async () => {
    const { id, client } = await player(10n)
    const res = await client.post<Flip>('/api/coinflip/play', { bet: 'all', call: 'heads' }, key())
    expect(res.status).toBe(200)
    expect(res.body.round).toMatchObject({ allIn: true, bigBet: true })
    const won = (res.body.round.payout ?? 0) > res.body.round.stake
    const [post] = await testDb.query<{ kind: string; body: string; meta: { userId: string } }>(
      `select kind, body, meta from chat_messages where meta->>'userId' = $1`,
      [id],
    )
    expect(post?.kind).toBe('system')
    expect(post?.body).toMatch(
      won ? /went all in on Coin flip and won 9$/ : /went all in on Coin flip and lost 10$/,
    )
  })
})

describe('GET /api/coinflip/room', () => {
  it("shows each player's latest flip and nothing hidden", async () => {
    const alice = await player(50n)
    const bob = await player(50n)
    await alice.client.post('/api/coinflip/play', { bet: '1', call: 'heads' }, key())
    const last = await alice.client.post<Flip>(
      '/api/coinflip/play',
      { bet: '2', call: 'tails' },
      key(),
    )
    const bobs = await bob.client.post<Flip>(
      '/api/coinflip/play',
      { bet: '3', call: 'heads' },
      key(),
    )

    const room = await bob.client.get<RoomState<CoinflipDetail>>('/api/coinflip/room')
    expect(room.status).toBe(200)
    const byPlayer = new Map(room.body.rounds.map((r) => [r.userId, r]))
    expect(byPlayer.get(alice.id)).toEqual(last.body.round)
    expect(byPlayer.get(bob.id)).toEqual(bobs.body.round)
    expect(JSON.stringify(room.body)).not.toContain('secret')
  })
})

describe('the house edge setting', () => {
  it('pays by the edge in force when the bet is placed, and saves it with the round', async () => {
    const admin = await createPlayer(testDb)
    const { client } = await player(100n)
    const set = (value: number) =>
      db().transaction((tx) =>
        changeConfig(tx, { key: 'coinflip_edge_pct', value, actorId: admin, now: new Date() }),
      )
    await set(0)
    try {
      let win: Flip | null = null
      for (let i = 0; i < 40 && !win; i++) {
        const res = await client.post<Flip>(
          '/api/coinflip/play',
          { bet: '1', call: 'heads' },
          key(),
        )
        expect(res.body.round.detail.edgePct).toBe(0)
        if (res.body.round.detail.face === 'heads') win = res.body
      }
      expect(win?.round).toMatchObject({ payout: 2, multiplier: 200 })
    } finally {
      await set(200)
    }
  })
})
