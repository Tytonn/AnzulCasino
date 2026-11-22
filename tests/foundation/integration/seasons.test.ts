/**
 * Season basics: create a season, find the running one, give starting
 * balances (late joiners too) and refuse bets at or after the end by
 * database time.
 */
import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { chips } from '../../../shared/chips.ts'
import { coreApi } from '../../../server/core/api.ts'
import { db } from '../../../server/lib/db.ts'
import {
  createSeason,
  requireBetsOpen,
  runningSeason,
  standings,
} from '../../../server/lib/seasons.ts'
import { credit, ledgerMismatches, readWallet } from '../../../server/lib/wallet.ts'
import { apiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'
import { createPlayer, loggedIn } from '../../helpers/fixtures.ts'

process.env.ADMIN_BOOTSTRAP_CODE = 'season-bootstrap'
const testDb = await useTestDatabase()

const HOUR = 3_600_000
const DAY = 24 * HOUR

async function dbNow(): Promise<number> {
  const [row] = await testDb.query<{ now: Date }>('select now() as now')
  return (row?.now as Date).getTime()
}

const key = () => ({ 'idempotency-key': randomUUID() })

// The tests below run in order and share one timeline:
//   a season that ended last month, the running season, and one next month.
const admin = apiClient(coreApi)
let adminId: string
let runningId: number

describe('creating seasons', () => {
  it('needs an admin', async () => {
    const signup = await admin.post('/api/auth/signup', {
      username: 'Tyton',
      password: 'admin password',
      inviteCode: 'season-bootstrap',
    })
    expect(signup.status).toBe(200)
    adminId = signup.body.user.id

    const player = await loggedIn(coreApi, await createPlayer(testDb))
    const now = await dbNow()
    const res = await player.post(
      '/api/seasons',
      {
        name: 'Sneaky',
        startsAt: new Date(now + DAY).toISOString(),
        endsAt: new Date(now + 2 * DAY).toISOString(),
      },
      key(),
    )
    expect(res.status).toBe(403)
  })

  it('schedules a future season with the configured starting balance', async () => {
    const now = await dbNow()
    const res = await admin.post(
      '/api/seasons',
      {
        name: 'Season 2',
        startsAt: new Date(now + 40 * DAY).toISOString(),
        endsAt: new Date(now + 70 * DAY).toISOString(),
      },
      key(),
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.season).toMatchObject({
      name: 'Season 2',
      startingBalance: 1_000,
      status: 'scheduled',
      phase: 'upcoming',
    })
    const [audit] = await testDb.query<{ action: string; actor_id: string }>(
      `select action, actor_id from audit_log where action = 'season.created'`,
    )
    expect(audit).toEqual({ action: 'season.created', actor_id: adminId })
    // Nobody has chips in a season that has not started.
    expect(await testDb.query('select * from wallets')).toEqual([])
  })

  it('refuses seasons that overlap, end before they start, or end in the past', async () => {
    const now = await dbNow()
    const attempt = (name: string, startsAt: number, endsAt: number) =>
      admin.post(
        '/api/seasons',
        {
          name,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
        },
        key(),
      )
    const overlap = await attempt('Clash', now + 50 * DAY, now + 80 * DAY)
    expect(overlap.status).toBe(409)
    expect(overlap.body.error.message).toBe('That overlaps Season 2. Seasons cannot overlap.')

    const backwards = await attempt('Backwards', now + 90 * DAY, now + 85 * DAY)
    expect(backwards.status).toBe(400)
    expect(backwards.body.error.message).toBe('The season must end after it starts.')

    const past = await attempt('Past', now - 10 * DAY, now - 9 * DAY)
    expect(past.status).toBe(400)
    expect(past.body.error.message).toBe('The season must end in the future.')
  })
})

describe('starting a season', () => {
  it('gives every player who is not disabled the starting balance, once', async () => {
    const alice = await createPlayer(testDb, 'alice')
    const bob = await createPlayer(testDb, 'bob')
    const gone = await createPlayer(testDb, 'gone')
    await testDb.query(`update users set disabled_at = now() where id = $1`, [gone])

    // Scheduled to start a moment ago, as if nobody had visited since.
    const now = await dbNow()
    const season = await db().transaction(async (tx) => {
      const created = await createSeason(tx, {
        name: 'Season 1',
        startsAt: new Date(now + 60_000),
        endsAt: new Date(now + 30 * DAY),
        actorId: adminId,
      })
      await tx.execute(
        sql`update seasons set starts_at = now() - interval '1 minute' where id = ${created.id}`,
      )
      return created
    })
    runningId = season.id
    expect(season.status).toBe('scheduled')

    // The first requests after the start time start it; only one does the work.
    const found = await Promise.all(Array.from({ length: 10 }, () => runningSeason()))
    for (const s of found) expect(s).toMatchObject({ id: season.id, status: 'active' })

    for (const id of [adminId, alice, bob]) {
      expect(await readWallet(db(), season.id, id)).toMatchObject({
        balance: chips(1_000),
        vault: 0n,
      })
    }
    expect(await readWallet(db(), season.id, gone)).toBeNull()
    // One season_start row for each player who is not disabled.
    const [starts] = await testDb.query<{ n: string }>(
      `select count(*) as n from ledger where season_id = $1 and reason = 'season_start'`,
      [season.id],
    )
    const [players] = await testDb.query<{ n: string }>(
      `select count(*) as n from users where disabled_at is null`,
    )
    expect(starts?.n).toBe(players?.n)
    expect(Number(starts?.n)).toBeGreaterThanOrEqual(3)
    expect(await ledgerMismatches(db(), season.id)).toEqual([])
  })

  it('gives a player who signs up late the same amount', async () => {
    const invite = await admin.post('/api/invites', { kind: 'invite' })
    const late = apiClient(coreApi)
    const signup = await late.post('/api/auth/signup', {
      username: 'latecomer',
      password: 'late password',
      inviteCode: invite.body.code.code,
    })
    expect(signup.status).toBe(200)
    expect(await readWallet(db(), runningId, signup.body.user.id)).toMatchObject({
      balance: chips(1_000),
    })
  })

  it('gives a wallet to anyone still missing one when they load the site', async () => {
    const id = await createPlayer(testDb, 'returning')
    const client = await loggedIn(coreApi, id)
    const res = await client.get('/api/season')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      current: { id: runningId, name: 'Season 1', status: 'active', phase: 'open' },
      next: { name: 'Season 2', phase: 'upcoming' },
      wallet: { balance: 1_000, vault: 0, tier: 'base' },
    })
    // Loading again changes nothing.
    await client.get('/api/season')
    const rows = await testDb.query(`select * from ledger where season_id = $1 and user_id = $2`, [
      runningId,
      id,
    ])
    expect(rows).toHaveLength(1)
  })
})

describe('the end of a season', () => {
  it('refuses bets at or after the end time, by database time', async () => {
    const [ended] = await testDb.query<{ id: number }>(
      `insert into seasons (name, starts_at, ends_at, starting_balance, status)
       values ('Season 0', now() - interval '60 days', now() - interval '31 days', 100, 'active')
       returning id`,
    )
    await expect(
      db().transaction((tx) => requireBetsOpen(tx, ended?.id as number)),
    ).rejects.toMatchObject({
      status: 409,
      code: 'season_over',
      message: 'This season has ended, so bets are closed.',
    })

    // Ends right now: "at" the end counts as over.
    await testDb.query(`update seasons set ends_at = now() where id = $1`, [ended?.id])
    await expect(
      db().transaction((tx) => requireBetsOpen(tx, ended?.id as number)),
    ).rejects.toMatchObject({ code: 'season_over' })
  })

  it('refuses bets before the start and takes them in between', async () => {
    const [future] = await testDb.query<{ id: number }>(
      `select id from seasons where name = 'Season 2'`,
    )
    await expect(
      db().transaction((tx) => requireBetsOpen(tx, future?.id as number)),
    ).rejects.toMatchObject({ code: 'season_not_started' })
    await expect(db().transaction((tx) => requireBetsOpen(tx, runningId))).resolves.toBeUndefined()
  })

  it('says the final day has come in the last 24 hours', async () => {
    await testDb.query(`update seasons set ends_at = now() + interval '2 hours' where id = $1`, [
      runningId,
    ])
    const client = await loggedIn(coreApi, adminId)
    const res = await client.get('/api/season')
    expect(res.body.current.phase).toBe('final_day')
    await testDb.query(`update seasons set ends_at = now() + interval '30 days' where id = $1`, [
      runningId,
    ])
  })
})

describe('the leaderboard', () => {
  it('ranks by net worth, and a tie goes to whoever got there first', async () => {
    const ids = await testDb.query<{ user_id: string; username: string }>(
      `select w.user_id, u.username from wallets w join users u on u.id = w.user_id
       where w.season_id = $1`,
      [runningId],
    )
    const id = (name: string) => ids.find((r) => r.username === name)?.user_id as string
    await db().transaction(async (tx) => {
      await credit(tx, { seasonId: runningId, userId: id('bob'), amount: 5n, reason: 'payout' })
    })
    await db().transaction(async (tx) => {
      await credit(tx, { seasonId: runningId, userId: id('alice'), amount: 5n, reason: 'payout' })
    })
    await testDb.query(
      `update wallets set balance = balance - 20, vault = vault + 20 where season_id = $1 and user_id = $2`,
      [runningId, id('alice')],
    )
    // Keep the ledger honest after moving chips by hand.
    await testDb.query(
      `insert into ledger (season_id, user_id, account, delta, balance_after, reason)
       values ($1, $2, 'wallet', -20, 985, 'vault_deposit'), ($1, $2, 'vault', 20, 20, 'vault_deposit')`,
      [runningId, id('alice')],
    )

    const board = await standings(db(), runningId)
    // Bob and Alice both have 1,005; Bob reached it first. The vault counts.
    expect(board.slice(0, 2).map((s) => [s.rank, s.username, s.netWorth])).toEqual([
      [1, 'bob', 1_005n],
      [2, 'alice', 1_005n],
    ])
    expect(board.find((s) => s.username === 'alice')).toMatchObject({
      balance: 985n,
      vault: 20n,
    })
    // Everyone else is level on 1,000, and the ones who started together share a rank.
    expect(board.find((s) => s.username === 'Tyton')?.rank).toBe(3)
    expect(board.some((s) => s.username === 'gone')).toBe(false)

    const client = await loggedIn(coreApi, adminId)
    const res = await client.get('/api/leaderboard')
    expect(res.body.seasonId).toBe(runningId)
    expect(res.body.standings[0]).toMatchObject({ rank: 1, username: 'bob', netWorth: 1_005 })
    expect(await ledgerMismatches(db(), runningId)).toEqual([])
  })
})
