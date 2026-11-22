/**
 * The live layer through the API (spec: Live events): the token endpoint,
 * and the news the foundation publishes after its commits, with versions a
 * browser can compare with what it fetched.
 */
import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { coreApi } from '../../../server/core/api.ts'
import { createCode } from '../../../server/core/invites.ts'
import { captureLive, type Outgoing, setDeployContext } from '../../../server/lib/live.ts'
import { verifyLocalToken } from '../../../server/lib/live-local.ts'
import { runningSeason } from '../../../server/lib/seasons.ts'
import { apiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, fundWallet, loggedIn } from '../../helpers/fixtures.ts'

process.env.ADMIN_BOOTSTRAP_CODE = 'live-bootstrap'
const testDb = await useTestDatabase()

let capture: { events: Outgoing[]; stop(): void }

beforeEach(() => {
  capture = captureLive()
})

afterEach(() => {
  capture.stop()
  setDeployContext(undefined)
  delete process.env.LIVE_RELAY_URL
  delete process.env.LIVE_RELAY_SECRET
})

/** The running season. The tests below run in order and share it. */
async function running() {
  const season = await runningSeason()
  if (!season) throw new Error('expected a running season')
  return season
}

async function latestLedgerId(userId: string): Promise<number> {
  const [row] = await testDb.query<{ id: string }>(
    'select max(id) as id from ledger where user_id = $1',
    [userId],
  )
  return Number(row?.id)
}

describe('GET /api/live/token', () => {
  it('needs a session', async () => {
    expect((await apiClient(coreApi).get('/api/live/token')).status).toBe(401)
  })

  it('says live updates are off when there is no transport', async () => {
    const player = await loggedIn(coreApi, await createPlayer(testDb))
    const res = await player.get('/api/live/token')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ transport: 'none' })
  })

  it("gives a token for the player's own channels, named for the deploy", async () => {
    process.env.LIVE_RELAY_URL = 'http://localhost:8888/__live'
    process.env.LIVE_RELAY_SECRET = 'integration-secret'
    const userId = await createPlayer(testDb)
    const player = await loggedIn(coreApi, userId)

    const local = await player.get('/api/live/token')
    expect(local.body).toMatchObject({ transport: 'local', prefix: 'local', clientId: userId })
    const body = verifyLocalToken(local.body.token, 'integration-secret')
    expect(Object.keys(body?.capability ?? {})).toContain(`local:user:${userId}`)

    const preview = await loggedIn(coreApi, userId, {
      deploy: { context: 'deploy-preview', id: 'd42' },
    })
    const res = await preview.get('/api/live/token')
    expect(res.body.prefix).toBe('preview-d42')
    expect(
      Object.keys(verifyLocalToken(res.body.token, 'integration-secret')?.capability ?? {}),
    ).toContain(`preview-d42:user:${userId}`)
  })
})

describe('news from the foundation', () => {
  it('announces a season once when the first request starts it', async () => {
    const [admin] = await testDb.query<{ id: string }>(
      `insert into users (username, password_hash, display_name, role)
       values ('live_admin', 'x', 'Live admin', 'admin') returning id`,
    )
    // A season whose start time is already behind it, not started yet.
    const [row] = await testDb.query<{ id: number }>(
      `insert into seasons (name, starts_at, ends_at, starting_balance, status, created_by)
       values ('Live season', now() - interval '1 minute', now() + interval '30 days', 100, 'scheduled', $1)
       returning id`,
      [admin?.id],
    )
    const started = await Promise.all(Array.from({ length: 5 }, () => runningSeason()))
    expect(new Set(started.map((s) => s?.id))).toEqual(new Set([row?.id]))
    const news = capture.events.filter((e) => e.name === 'season.state')
    expect(news).toHaveLength(1)
    expect(news[0]).toMatchObject({
      channel: 'feed',
      envelope: { data: { seasonId: row?.id, phase: 'open' } },
    })
  })

  it("puts a late joiner on everyone's leaderboard, with a version", async () => {
    const season = await running()
    const [admin] = await testDb.query<{ id: string }>(
      `select id from users where username = 'live_admin'`,
    )
    const { code } = await createCode(admin?.id as string, { kind: 'invite' })
    const signup = await apiClient(coreApi).post('/api/auth/signup', {
      username: `late_${randomUUID().slice(0, 6)}`,
      password: 'late joiner password',
      inviteCode: code,
    })
    expect(signup.status).toBe(200)
    const userId: string = signup.body.user.id
    const version = await latestLedgerId(userId)

    const wallet = capture.events.find((e) => e.channel === `user:${userId}`)
    const standing = capture.events.find(
      (e) =>
        e.name === 'standing.changed' && (e.envelope.data as { userId: string }).userId === userId,
    )
    expect(wallet).toMatchObject({
      name: 'wallet.updated',
      envelope: { version, data: { seasonId: season.id, balance: 100, vault: 0 } },
    })
    expect(standing).toMatchObject({
      channel: 'feed',
      envelope: { version, data: { netWorth: 100, tier: 'base' } },
    })
  })

  it('sends the same versions with fetched state, so a browser can drop older news', async () => {
    const { id: seasonId } = await running()
    const userId = await createPlayer(testDb)
    await fundWallet(seasonId, userId, 12_345n)
    const version = await latestLedgerId(userId)
    const player = await loggedIn(coreApi, userId)

    const season = await player.get('/api/season')
    expect(season.body.wallet).toMatchObject({ balance: 12_345, version })
    const board = await player.get('/api/leaderboard')
    const mine = board.body.standings.find((s: { userId: string }) => s.userId === userId)
    expect(mine).toMatchObject({ netWorth: 12_345, version })
  })

  it('announces a season the admin creates after the commit, and only once', async () => {
    const adminId = (
      await testDb.query<{ id: string }>(`select id from users where username = 'live_admin'`)
    )[0]?.id as string
    const admin = await loggedIn(coreApi, adminId)
    const [last] = await testDb.query<{ ends: Date }>('select max(ends_at) as ends from seasons')
    const startsAt = new Date((last?.ends as Date).getTime() + 86_400_000)
    const body = {
      name: 'Next one',
      startsAt: startsAt.toISOString(),
      endsAt: new Date(startsAt.getTime() + 30 * 86_400_000).toISOString(),
    }
    const headers = { 'idempotency-key': randomUUID() }
    const first = await admin.post('/api/seasons', body, headers)
    expect(first.status).toBe(200)
    await admin.settle()
    const again = await admin.post('/api/seasons', body, headers)
    await admin.settle()
    expect(again.body).toEqual(first.body)

    const news = capture.events.filter(
      (e) =>
        e.name === 'season.state' &&
        (e.envelope.data as { seasonId: number }).seasonId === first.body.season.id,
    )
    expect(news).toHaveLength(1)
    expect(news[0]?.envelope.data).toEqual({ seasonId: first.body.season.id, phase: 'upcoming' })
  })
})
