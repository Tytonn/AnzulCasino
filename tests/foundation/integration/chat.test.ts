/**
 * Basic chat, the player list and the ticker (spec: Social layer): pages of
 * messages, the burst limit, plain text, an admin deleting, the live news of
 * each, and rounds and steal attempts together in the ticker.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { coreApi } from '../../../server/core/api.ts'
import { systemPost } from '../../../server/lib/chat.ts'
import { db } from '../../../server/lib/db.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import type { TickerItem } from '../../../shared/ticker.ts'
import { apiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, createSeason, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

const testDb = await useTestDatabase()

let capture: { events: Outgoing[]; stop(): void }

beforeEach(() => {
  capture = captureLive()
})

afterEach(() => {
  capture.stop()
})

async function makeAdmin(userId: string) {
  await testDb.query(`update users set role = 'admin' where id = $1`, [userId])
}

/** Clears the burst window so each test starts with a full allowance. */
async function resetLimits() {
  await testDb.query(`delete from rate_limits`)
}

describe('POST /api/chat', () => {
  beforeEach(resetLimits)

  it('needs a session', async () => {
    expect((await apiClient(coreApi).post('/api/chat', { body: 'hi' })).status).toBe(401)
  })

  it('saves plain text and announces it after the commit', async () => {
    const userId = await createPlayer(testDb)
    const player = await loggedIn(coreApi, userId)
    const res = await player.post('/api/chat', { body: '  hello\n\tthere  <b>you</b>  ' })
    expect(res.status).toBe(200)
    expect(res.body.message).toMatchObject({
      userId,
      kind: 'player',
      body: 'hello there <b>you</b>',
      meta: null,
    })
    await player.settle()
    const event = capture.events.find((e) => e.name === 'chat.message')
    expect(event?.channel).toBe('chat')
    expect(event?.envelope.version).toBe(res.body.message.id)
    expect(event?.envelope.data).toEqual(res.body.message)
  })

  it('refuses an empty or too long message, counting emoji as one character', async () => {
    const player = await loggedIn(coreApi, await createPlayer(testDb))
    expect((await player.post('/api/chat', { body: ' \n ' })).body.error.message).toBe(
      'Type a message first.',
    )
    expect((await player.post('/api/chat', { body: 'a'.repeat(301) })).status).toBe(400)
    // 300 emoji are 600 UTF-16 units but 300 characters.
    expect((await player.post('/api/chat', { body: '🎲'.repeat(300) })).status).toBe(200)
    expect((await player.post('/api/chat', { body: { text: 'x' } })).status).toBe(400)
  })

  it('removes characters that reverse text', async () => {
    const player = await loggedIn(coreApi, await createPlayer(testDb))
    const res = await player.post('/api/chat', { body: 'abc‮def' })
    expect(res.body.message.body).toBe('abcdef')
  })

  it('allows 5 messages per 10 seconds', async () => {
    const player = await loggedIn(coreApi, await createPlayer(testDb))
    const results = []
    for (let i = 0; i < 6; i++) results.push(await player.post('/api/chat', { body: `m${i}` }))
    expect(results.slice(0, 5).map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(results[5]?.status).toBe(429)
    expect(results[5]?.body.error.message).toMatch(/^Slow down a little/)
    // Someone else still can.
    const other = await loggedIn(coreApi, await createPlayer(testDb))
    expect((await other.post('/api/chat', { body: 'me too' })).status).toBe(200)
  })
})

describe('GET /api/chat', () => {
  it('loads the newest page first and older pages on request, oldest first in each', async () => {
    await testDb.query(`delete from chat_messages`)
    await resetLimits()
    const userId = await createPlayer(testDb)
    const values = Array.from({ length: 130 }, (_, i) => `('${userId}', 'player', 'n${i}')`)
    await testDb.query(`insert into chat_messages (user_id, kind, body) values ${values.join(',')}`)
    const player = await loggedIn(coreApi, userId)

    const first = await player.get('/api/chat')
    expect(first.status).toBe(200)
    expect(first.body.messages).toHaveLength(100)
    expect(first.body.more).toBe(true)
    expect(first.body.messages[0].body).toBe('n30')
    expect(first.body.messages.at(-1).body).toBe('n129')

    const older = await player.get(`/api/chat?before=${first.body.messages[0].id}`)
    expect(older.body.messages).toHaveLength(30)
    expect(older.body.more).toBe(false)
    expect(older.body.messages.at(-1).body).toBe('n29')

    const few = await player.get('/api/chat?limit=5')
    expect(few.body.messages.map((m: { body: string }) => m.body)).toEqual([
      'n125',
      'n126',
      'n127',
      'n128',
      'n129',
    ])
    expect((await player.get('/api/chat?limit=500')).status).toBe(400)
    expect((await player.get('/api/chat?before=abc')).status).toBe(400)
  })

  it('includes system posts written by lanes', async () => {
    const player = await loggedIn(coreApi, await createPlayer(testDb))
    const event = await systemPost(db(), 'Alice won 1,250 on roulette', {
      tone: 'win',
      roundId: 7,
    })
    const page = await player.get('/api/chat?limit=1')
    expect(page.body.messages[0]).toMatchObject({
      id: event.envelope.version,
      userId: null,
      kind: 'system',
      body: 'Alice won 1,250 on roulette',
      meta: { tone: 'win', roundId: 7 },
    })
  })
})

describe('DELETE /api/chat/:id', () => {
  beforeEach(resetLimits)

  it('lets only an admin delete, writes the audit log, and announces it', async () => {
    const authorId = await createPlayer(testDb)
    const author = await loggedIn(coreApi, authorId)
    const sent = await author.post('/api/chat', { body: 'delete me' })
    const id = sent.body.message.id as number

    expect((await author.del(`/api/chat/${id}`)).status).toBe(403)

    const adminId = await createPlayer(testDb)
    await makeAdmin(adminId)
    const admin = await loggedIn(coreApi, adminId)
    capture.events.length = 0
    expect((await admin.del(`/api/chat/${id}`)).status).toBe(200)
    await admin.settle()
    expect(capture.events).toHaveLength(1)
    expect(capture.events[0]).toMatchObject({ channel: 'chat', name: 'chat.deleted' })
    expect(capture.events[0]?.envelope.data).toEqual({ id })

    const page = await author.get('/api/chat?limit=100')
    expect(page.body.messages.some((m: { id: number }) => m.id === id)).toBe(false)

    const [audit] = await testDb.query<{ actor_id: string; before: unknown }>(
      `select actor_id, before from audit_log where action = 'chat.deleted' and target = $1`,
      [`chat:${id}`],
    )
    expect(audit?.actor_id).toBe(adminId)
    expect(JSON.stringify(audit?.before)).not.toContain('delete me')

    expect((await admin.del(`/api/chat/${id}`)).status).toBe(404)
    expect((await admin.del('/api/chat/nope')).status).toBe(400)
  })
})

describe('GET /api/players and /api/ticker', () => {
  let seasonId: number
  beforeAll(async () => {
    seasonId = await createSeason(testDb)
  })

  it('lists every player who is not disabled, with their tier this season', async () => {
    const aliceId = await createPlayer(testDb, `alice_${seasonId}`)
    const goneId = await createPlayer(testDb, `gone_${seasonId}`)
    await testDb.query(`update users set disabled_at = now() where id = $1`, [goneId])
    await fundWallet(seasonId, aliceId, 10_000n)
    await testDb.query(`update wallets set tier = 'silver' where season_id = $1 and user_id = $2`, [
      seasonId,
      aliceId,
    ])
    const viewerId = await createPlayer(testDb)
    const viewer = await loggedIn(coreApi, viewerId)

    const res = await viewer.get('/api/players')
    expect(res.status).toBe(200)
    const byId = new Map(res.body.players.map((p: { id: string }) => [p.id, p]))
    expect(byId.get(aliceId)).toMatchObject({
      username: `alice_${seasonId}`,
      role: 'player',
      tier: 'silver',
      avatar: expect.any(String),
      avatarColor: expect.any(String),
    })
    expect(byId.has(goneId)).toBe(false)
    expect(byId.get(viewerId)).toMatchObject({ tier: 'base' })
    expect(Object.keys(byId.get(viewerId) as object).sort()).toEqual(
      ['avatar', 'avatarColor', 'displayName', 'id', 'role', 'tier', 'username'].sort(),
    )
  })

  it('shows the latest rounds and steal attempts of the season, newest first, with no secrets', async () => {
    const userId = await createPlayer(testDb)
    const targetId = await createPlayer(testDb)
    await fundWallet(seasonId, userId, 10_000n)
    await fundWallet(seasonId, targetId, 10_000n)
    for (const [i, payout] of [0, 400, 150].entries()) {
      await testDb.query(
        `insert into game_rounds (season_id, user_id, game, status, stake, payout, multiplier,
           detail, summary, big_bet, started_at, settled_at)
         values ($1, $2, 'coinflip', 'settled', 200, $3, $4, '{"side":"heads"}', $5, $6,
           now() - interval '1 minute', now() - make_interval(secs => $7))`,
        [seasonId, userId, payout, payout / 200, `Round ${i}`, i === 1, 30 - i],
      )
    }
    await testDb.query(
      `insert into game_rounds (season_id, user_id, game, stake, secret)
       values ($1, $2, 'coinflip', 100, '{"hidden":true}')`,
      [seasonId, userId],
    )
    // One attempt between the first two rounds, and one newer than every round.
    for (const [outcome, amount, fine, ago] of [
      ['failed', 0, 300, 29.5],
      ['success', 1_250, 0, 10],
    ] as const) {
      await testDb.query(
        `insert into steals (season_id, thief_id, target_id, game_day, outcome, amount, fine,
           thief_rank, target_rank, created_at)
         values ($1, $2, $3, current_date, $4, $5, $6, 4, 1, now() - make_interval(secs => $7))`,
        [seasonId, userId, targetId, outcome, amount, fine, ago],
      )
    }
    const player = await loggedIn(coreApi, userId)
    const res = await player.get('/api/ticker')
    expect(res.status).toBe(200)
    const items = res.body.items as TickerItem[]
    expect(
      items.map((item) =>
        item.kind === 'round' ? item.round.summary : `${item.steal.outcome} steal`,
      ),
    ).toEqual(['success steal', 'Round 2', 'Round 1', 'failed steal', 'Round 0'])
    expect(items[2]).toEqual({
      kind: 'round',
      round: {
        seasonId,
        roundId: expect.any(Number),
        game: 'coinflip',
        userId,
        stake: 200,
        payout: 400,
        net: 200,
        multiplier: 200,
        summary: 'Round 1',
        bigBet: true,
      },
    })
    expect(items[0]).toEqual({
      kind: 'steal',
      steal: {
        id: expect.any(Number),
        seasonId,
        thiefId: userId,
        targetId,
        gameDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        outcome: 'success',
        amount: 1_250,
        fine: 0,
        thiefRank: 4,
        targetRank: 1,
        createdAt: expect.any(String),
      },
    })
    expect(items[3]).toMatchObject({ kind: 'steal', steal: { outcome: 'failed', fine: 300 } })
    expect(JSON.stringify(res.body)).not.toContain('hidden')
  })
})
