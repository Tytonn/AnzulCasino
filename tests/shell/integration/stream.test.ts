/**
 * The stream (spec: The stream), through a stand-in game built the way a
 * lane builds one: every round gets one card row in the bet's transaction,
 * the card's live news carries the round without its secret, GET /api/stream
 * pages each filter from the database with each card's round as it is now,
 * the SQL filters match streamTopic() and filterShows(), the classic chat
 * leaves cards out, and .bal and .lb post for everyone only while
 * stream_bal_lb is public.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { type ChatMessage, filterShows, STREAM_FILTERS, streamTopic } from '../../../shared/chat.ts'
import { CHIP } from '../../../shared/chips.ts'
import { coreApi } from '../../../server/core/api.ts'
import { insertChatMessage, systemPost } from '../../../server/lib/chat.ts'
import { changeConfig } from '../../../server/lib/config.ts'
import { db } from '../../../server/lib/db.ts'
import { createApi, route } from '../../../server/lib/http.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { defineServerGame, playTransaction } from '../../../server/lib/rounds.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

const SECRET = 'the-hidden-card-5d1c'
const dice = defineServerGame({ id: 'streamdice', name: 'Stream dice' })

const gameApi = createApi([
  route({
    method: 'POST',
    path: '/api/streamdice/start',
    auth: 'user',
    idempotent: true,
    input: z.strictObject({ bet: z.string().max(32) }),
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) =>
        play.result(
          await play.start({ bet: ctx.input.bet, detail: { step: 0 }, secret: { hidden: SECRET } }),
        ),
      ),
  }),
  route({
    method: 'POST',
    path: '/api/streamdice/settle',
    auth: 'user',
    idempotent: true,
    input: z.strictObject({ payout: z.number().int().min(0) }),
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.require<{ step: number }>()
        return play.result(
          await play.settle(round, {
            payout: BigInt(ctx.input.payout),
            detail: { step: 1 },
            summary: 'Six',
          }),
        )
      }),
  }),
  route({
    method: 'POST',
    path: '/api/streamdice/instant',
    auth: 'user',
    idempotent: true,
    // `times` in hundredths: 200 pays twice the stake, 0 loses it.
    input: z.strictObject({ bet: z.string().max(32), times: z.number().int().min(0) }),
    run: (ctx) =>
      playTransaction(ctx, dice, async (play) => {
        const round = await play.start({ bet: ctx.input.bet, detail: { step: 0 } })
        const payout = (round.stake * BigInt(ctx.input.times)) / 100n
        return play.result(
          await play.settle(round, { payout, detail: { step: 1 }, summary: 'Rolled' }),
        )
      }),
  }),
])

/** The stand-in game's routes and the core API behind one handler, as on the site. */
const api: typeof coreApi = (req, context) =>
  new URL(req.url).pathname.startsWith('/api/streamdice/')
    ? gameApi(req, context)
    : coreApi(req, context)

let seasonId: number
let admin: string
let capture: { events: Outgoing[]; stop(): void }

beforeAll(async () => {
  seasonId = await createSeason(testDb)
  admin = await createPlayer(testDb, 'stream_admin')
})

beforeEach(async () => {
  capture = captureLive()
  await testDb.query(`delete from rate_limits`)
  await testDb.query(`delete from chat_messages`)
})

afterEach(async () => {
  capture.stop()
  await testDb.query('delete from config')
})

const key = () => ({ 'idempotency-key': randomUUID() })

async function player(whole: bigint, name?: string) {
  const id = await createPlayer(testDb, name)
  await fundWallet(seasonId, id, whole * CHIP)
  return { id, client: await loggedIn(api, id) }
}

function chatEvents() {
  return capture.events
    .filter((e) => e.name === 'chat.message')
    .map((e) => ({ version: e.envelope.version, data: e.envelope.data as ChatMessage }))
}

function cardsFor(roundId: number) {
  return testDb.query<{ id: number; user_id: string; body: string; meta: unknown }>(
    `select id::int as id, user_id, body, meta from chat_messages
     where kind = 'card' and meta ->> 'roundId' = $1`,
    [String(roundId)],
  )
}

function setting(key: string, value: unknown) {
  return db().transaction((tx) => changeConfig(tx, { key, value, actorId: admin, now: new Date() }))
}

describe('cards', () => {
  it('writes one card with each round and sends it with the round, never the secret', async () => {
    const { id, client } = await player(100n)
    const res = await client.post('/api/streamdice/start', { bet: '25' }, key())
    expect(res.status).toBe(200)
    const round = res.body.round

    const cards = await cardsFor(round.id)
    expect(cards).toEqual([
      {
        id: expect.any(Number),
        user_id: id,
        body: 'Stream dice · 25',
        meta: { game: 'streamdice', roundId: round.id },
      },
    ])

    // The response carries the card too, so the player's stream shows it at once.
    expect(res.body.card).toMatchObject({
      id: cards[0]?.id,
      kind: 'card',
      userId: id,
      meta: { game: 'streamdice', roundId: round.id },
      round,
    })

    await client.settle()
    const sent = chatEvents().filter((e) => e.data.kind === 'card')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.version).toBe(cards[0]?.id)
    expect(sent[0]?.data).toMatchObject({
      id: cards[0]?.id,
      userId: id,
      kind: 'card',
      meta: { game: 'streamdice', roundId: round.id },
      round,
    })
    expect(JSON.stringify(capture.events)).not.toContain(SECRET)

    // Moving the round on does not write another card: the room's events carry it.
    const settled = await client.post('/api/streamdice/settle', { payout: 5000 }, key())
    expect(settled.body.card).toBeUndefined()
    expect(await cardsFor(round.id)).toHaveLength(1)
  })

  it('writes no card for a bet it refuses', async () => {
    const { client } = await player(10n)
    const res = await client.post('/api/streamdice/start', { bet: '11' }, key())
    expect(res.status).toBe(400)
    expect(await testDb.query(`select id from chat_messages where kind = 'card'`)).toEqual([])
  })

  it('keeps one card per round and a game on every card, in the database', async () => {
    const { id, client } = await player(100n)
    const res = await client.post('/api/streamdice/instant', { bet: '5', times: 0 }, key())
    const meta = JSON.stringify({ game: 'streamdice', roundId: res.body.round.id })
    await expect(
      testDb.query(
        `insert into chat_messages (user_id, kind, body, meta) values ($1, 'card', 'again', $2)`,
        [id, meta],
      ),
    ).rejects.toMatchObject({ code: '23505' })
    await expect(
      testDb.query(
        `insert into chat_messages (user_id, kind, body, meta) values ($1, 'card', 'no game', '{"roundId": -1}')`,
        [id],
      ),
    ).rejects.toMatchObject({ code: '23514' })
  })
})

describe('GET /api/stream', () => {
  it('pages the newest items oldest first, each card with its round as it is now', async () => {
    const { client } = await player(100n)
    const open = await client.post('/api/streamdice/start', { bet: '10' }, key())
    await client.post('/api/streamdice/settle', { payout: 2000 }, key())
    await client.post('/api/chat', { body: 'nice one' }, key())
    await client.post('/api/streamdice/start', { bet: '10' }, key())
    await client.post('/api/chat', { body: 'again' }, key())

    const newest = await client.get('/api/stream?limit=3')
    expect(newest.status).toBe(200)
    expect(newest.body.filter).toBe('all')
    expect(newest.body.more).toBe(true)
    expect(newest.body.items.map((m: ChatMessage) => [m.kind, m.body])).toEqual([
      ['player', 'nice one'],
      ['card', 'Stream dice · 10'],
      ['player', 'again'],
    ])
    // The open round's card has its round; nothing in the page holds the secret.
    expect(newest.body.items[1].round).toMatchObject({ status: 'open', stake: 1000 })
    expect(JSON.stringify(newest.body)).not.toContain(SECRET)

    const older = await client.get(`/api/stream?limit=3&before=${newest.body.items[0].id}`)
    expect(older.body.more).toBe(false)
    expect(older.body.items).toHaveLength(1)
    // The first round's card shows it settled, not as it was when the card was written.
    expect(older.body.items[0].round).toMatchObject({
      id: open.body.round.id,
      status: 'settled',
      payout: 2000,
    })
  })

  it('shows under each filter what streamTopic and filterShows say it shows', async () => {
    const { id, client } = await player(100n, 'filter_player')
    await client.post('/api/chat', { body: 'hello' }, key())
    await insertChatMessage(db(), { userId: id, kind: 'gif', body: 'a dancing cat', meta: {} })
    // A small loss: its card only. A 10x win: its card, and a big result post the card covers.
    await client.post('/api/streamdice/instant', { bet: '1', times: 0 }, key())
    await client.post('/api/streamdice/instant', { bet: '5', times: 1_000 }, key())
    // A work line and a shared round's big result: games. An announcement: news.
    await systemPost(db(), 'filter_player · Work: You parked cars. +59', {
      tone: 'win',
      userId: id,
      category: 'game',
    })
    await systemPost(db(), 'filter_player won 900 on Roulette', { tone: 'win', category: 'game' })
    await systemPost(db(), 'The season ends tomorrow', { tone: 'info' })
    await client.post('/api/chat', { body: 'gone soon' }, key())
    await testDb.query(`update chat_messages set deleted_at = now() where body = 'gone soon'`)

    const rows = await testDb.query<{ id: number; kind: ChatMessage['kind']; meta: unknown }>(
      `select id::int as id, kind, meta from chat_messages where deleted_at is null order by id`,
    )
    expect(
      rows.filter((r) => r.kind === 'system' && streamTopic(r as ChatMessage) === null),
    ).toHaveLength(1)

    for (const filter of STREAM_FILTERS) {
      const page = await client.get(`/api/stream?filter=${filter}`)
      expect(page.body.filter).toBe(filter)
      const expected = rows
        .filter((r) => filterShows(filter, streamTopic(r as ChatMessage)))
        .map((r) => r.id)
      expect(
        page.body.items.map((m: ChatMessage) => m.id),
        filter,
      ).toEqual(expected)
    }
    const chatOnly = await client.get('/api/stream?filter=chat')
    expect(chatOnly.body.items.map((m: ChatMessage) => m.body)).toEqual([
      'hello',
      'a dancing cat',
      'The season ends tomorrow',
    ])
  })

  it("lists the player's own open cards under any filter, for the pinned spot", async () => {
    const { id, client } = await player(100n)
    const other = await player(100n)
    const open = await client.post('/api/streamdice/start', { bet: '10' }, key())
    await client.post('/api/streamdice/instant', { bet: '1', times: 0 }, key())
    await other.client.post('/api/streamdice/start', { bet: '10' }, key())

    const chatOnly = await client.get('/api/stream?filter=chat')
    expect(chatOnly.body.items).toEqual([])
    expect(chatOnly.body.mine).toHaveLength(1)
    expect(chatOnly.body.mine[0]).toMatchObject({
      kind: 'card',
      userId: id,
      round: { id: open.body.round.id, status: 'open' },
    })
    expect(JSON.stringify(chatOnly.body)).not.toContain(SECRET)
    const older = await client.get(`/api/stream?before=${chatOnly.body.mine[0].id + 1}`)
    expect(older.body.mine).toEqual([])
  })

  it('refuses a filter it does not know', async () => {
    const { client } = await player(10n)
    expect((await client.get('/api/stream?filter=bets')).status).toBe(400)
  })
})

describe('GET /api/chat', () => {
  it('leaves the cards out of the classic chat and keeps the big result posts', async () => {
    const { client } = await player(100n)
    await client.post('/api/streamdice/instant', { bet: '5', times: 1_000 }, key())
    const page = await client.get('/api/chat')
    expect(page.body.messages.map((m: ChatMessage) => m.kind)).toEqual(['system'])
    expect(page.body.messages[0].body).toMatch(/won 45 on Stream dice, 10x the bet$/)
  })
})

describe('POST /api/stream/lookup', () => {
  it('answers only the player while the setting keeps lookups private', async () => {
    const { client } = await player(100n)
    const res = await client.post('/api/stream/lookup', { what: 'balance' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('lookup_private')
    expect(await testDb.query(`select id from chat_messages`)).toEqual([])
  })

  it('posts a balance for everyone once the setting says so', async () => {
    const asker = await player(100n, 'lookup_asker')
    const other = await player(250n, 'lookup_other')
    await setting('stream_bal_lb', 'public')

    const own = await asker.client.post('/api/stream/lookup', { what: 'balance' })
    expect(own.status).toBe(200)
    const theirs = await asker.client.post('/api/stream/lookup', {
      what: 'balance',
      player: '@Lookup_Other',
    })
    expect(theirs.status).toBe(200)
    const nobody = await asker.client.post('/api/stream/lookup', {
      what: 'balance',
      player: 'nobody',
    })
    expect(nobody.status).toBe(404)
    expect(nobody.body.error.message).toBe('Nobody called nobody is playing this season.')

    const posts = await testDb.query<{ body: string; meta: Record<string, unknown> }>(
      `select body, meta from chat_messages order by id`,
    )
    expect(posts).toHaveLength(2)
    expect(posts[0]?.body).toMatch(
      /^lookup_asker: 100 in the wallet, 0 in the vault, Base, \d+\w\w of \d+$/,
    )
    expect(posts[0]?.meta).toMatchObject({
      tone: 'info',
      userId: asker.id,
      category: 'game',
      lookup: { kind: 'balance', userId: asker.id, balance: 10_000, vault: 0, tier: 'base' },
    })
    expect(posts[1]?.body).toMatch(/^lookup_asker checked lookup_other: 250 in the wallet, /)
    expect(posts[1]?.meta).toMatchObject({ lookup: { userId: other.id, balance: 25_000 } })

    await asker.client.settle()
    expect(chatEvents().map((e) => e.data.body)).toEqual(posts.map((p) => p.body))
  })

  it('posts the top of the leaderboard', async () => {
    const asker = await player(300n, 'board_asker')
    await setting('stream_bal_lb', 'public')
    const res = await asker.client.post('/api/stream/lookup', { what: 'leaderboard' })
    expect(res.status).toBe(200)
    const [post] = await testDb.query<{ body: string; meta: { lookup: Record<string, any> } }>(
      `select body, meta from chat_messages`,
    )
    const players = Number(
      (await testDb.query<{ n: string }>(`select count(*) as n from wallets`))[0]?.n,
    )
    expect(post?.body).toMatch(/^board_asker checked the leaderboard: 1\. /)
    expect(post?.meta.lookup).toMatchObject({ kind: 'leaderboard', players })
    expect(post?.meta.lookup.rows.length).toBe(Math.min(players, 5))
    expect(post?.meta.lookup.rows[0]).toMatchObject({ rank: 1 })
    // A lookup is a game item: it shows under Games only, not under Chat only.
    expect(streamTopic({ kind: 'system', meta: post?.meta ?? null })).toBe('game')
  })
})
