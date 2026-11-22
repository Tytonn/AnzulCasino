/**
 * The test accounts (shared/test-accounts.ts): `test` and `test2` with the
 * password `test`, on deploy previews, branch deploys and local development
 * only. The tests below run in order on one database: first the deploys
 * where they are off, while the database has no test accounts, then a
 * preview, where the first sign-in makes everything.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { coreApi } from '../../../server/core/api.ts'
import { testAccountsOn } from '../../../server/core/test-accounts.ts'
import { db } from '../../../server/lib/db.ts'
import type { DeployInfo } from '../../../server/lib/deploy.ts'
import { captureLive, type Outgoing } from '../../../server/lib/live.ts'
import { debit, ledgerMismatches } from '../../../server/lib/wallet.ts'
import { CHIP } from '../../../shared/chips.ts'
import { addGameDays, gameDay, gameDayStart } from '../../../shared/game-day.ts'
import {
  isTestUsername,
  TEST_ACCOUNTS,
  TEST_BALANCE,
  TEST_PASSWORD,
} from '../../../shared/test-accounts.ts'
import { apiClient } from '../../helpers/api.ts'
import { useTestDatabase } from '../../helpers/db.ts'

const testDb = await useTestDatabase()

const PREVIEW: DeployInfo = { context: 'deploy-preview', id: 'preview-1', published: false }

let capture: { events: Outgoing[]; stop(): void }
beforeEach(() => {
  capture = captureLive()
})
afterEach(() => {
  capture.stop()
})

function signIn(deploy: DeployInfo | undefined, username = 'test', password = TEST_PASSWORD) {
  return apiClient(coreApi, { deploy }).post('/api/auth/login', { username, password })
}

async function testUsers() {
  return testDb.query<{ id: string; username: string; display_name: string; role: string }>(
    `select id, username, display_name, role from users
     where lower(username) in ('test', 'test2') order by username`,
  )
}

async function seasonRows() {
  return testDb.query<{ id: number; name: string; starts_at: Date; ends_at: Date; status: string }>(
    `select id, name, starts_at, ends_at, status from seasons order by id`,
  )
}

/** Each test account's wallet in the season, by username. */
async function wallets(seasonId: number) {
  const found = await testDb.query<{ username: string; balance: string }>(
    `select u.username, w.balance from wallets w join users u on u.id = w.user_id
     where w.season_id = $1 and lower(u.username) in ('test', 'test2')`,
    [seasonId],
  )
  return Object.fromEntries(found.map((w) => [w.username, BigInt(w.balance)]))
}

async function topUps(seasonId: number) {
  return testDb.query<{ username: string; delta: string }>(
    `select u.username, l.delta from ledger l join users u on u.id = l.user_id
     where l.season_id = $1 and l.reason = 'admin_adjust' order by l.id`,
    [seasonId],
  )
}

describe('where the test accounts are on', () => {
  it('only previews, branch deploys and local development, never the published deploy', () => {
    expect(testAccountsOn(PREVIEW)).toBe(true)
    expect(testAccountsOn({ context: 'branch-deploy', id: 'b', published: false })).toBe(true)
    expect(testAccountsOn({ context: 'dev', id: '0', published: false })).toBe(true)

    // Every production deploy shares the live database, published or not.
    expect(testAccountsOn({ context: 'production', id: 'p', published: true })).toBe(false)
    expect(testAccountsOn({ context: 'production', id: 'p', published: false })).toBe(false)
    // Belt and braces: whatever the context says, never the published deploy.
    expect(testAccountsOn({ ...PREVIEW, published: true })).toBe(false)
    // Unknown or missing: off.
    expect(testAccountsOn({ context: 'something-new', id: 'x', published: false })).toBe(false)
    expect(testAccountsOn(undefined)).toBe(false)
    expect(testAccountsOn(null)).toBe(false)
  })

  it('knows the usernames in any case', () => {
    expect(isTestUsername('test')).toBe(true)
    expect(isTestUsername(' Test2 ')).toBe(true)
    expect(isTestUsername('tester')).toBe(false)
    expect(isTestUsername('alice')).toBe(false)
  })
})

describe('on production', () => {
  const UNPUBLISHED: DeployInfo = { context: 'production', id: 'newest-main', published: false }

  it('signing in as test is refused and creates nothing', async () => {
    expect(await testUsers()).toEqual([])
    for (const deploy of [
      { context: 'production', id: 'live', published: true },
      UNPUBLISHED,
      { ...PREVIEW, published: true },
      undefined,
    ]) {
      const res = await signIn(deploy)
      expect(res.status, JSON.stringify(deploy)).toBe(400)
    }
    expect(await testUsers()).toEqual([])
    expect(await seasonRows()).toEqual([])
    expect(capture.events).toEqual([])
    // Those wrong passwords count toward test's lockout; start the next test clean.
    await testDb.query(`delete from rate_limits where bucket = 'login_failed'`)
  })

  it('the live site only says the password is wrong', async () => {
    for (const deploy of [
      { context: 'production', id: 'live', published: true },
      { ...PREVIEW, published: true },
      undefined,
    ]) {
      const res = await signIn(deploy)
      expect(res.body.error, JSON.stringify(deploy)).toEqual({
        code: 'bad_credentials',
        message: 'Wrong username or password.',
      })
    }
    await testDb.query(`delete from rate_limits where bucket = 'login_failed'`)
  })

  it('a deploy opened by its own link says the test accounts are for previews', async () => {
    for (const [username, password] of [
      ['test', TEST_PASSWORD],
      ['TEST2', TEST_PASSWORD],
      ['test', 'a wrong password'],
    ] as const) {
      const res = await signIn(UNPUBLISHED, username, password)
      expect(res.status, username).toBe(400)
      expect(res.body.error).toEqual({
        code: 'test_accounts_off',
        message:
          'The test accounts only work on deploy previews. This deploy uses the live database.',
      })
    }
    // Any other username is an ordinary wrong password there too.
    const other = await signIn(UNPUBLISHED, 'nobody_here', 'not the password')
    expect(other.body.error.code).toBe('bad_credentials')
    // Still a wrong password: it counts toward the lockout like any other.
    const [failures] = await testDb.query<{ count: number }>(
      `select sum(count)::int as count from rate_limits
       where bucket = 'login_failed' and subject = 'test'`,
    )
    expect(failures?.count).toBe(2)
    expect(await testUsers()).toEqual([])
    expect(capture.events).toEqual([])
    await testDb.query(`delete from rate_limits where bucket = 'login_failed'`)
  })
})

describe('on a deploy preview', () => {
  let seasonId: number

  it('the first sign-in makes both accounts, a test season and 1,000 chips each', async () => {
    const res = await signIn(PREVIEW)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.user).toMatchObject({ username: 'test', displayName: 'Test', role: 'player' })

    const users = await testUsers()
    expect(users.map((u) => [u.username, u.display_name, u.role])).toEqual(
      TEST_ACCOUNTS.map((a) => [a.username, a.displayName, 'player']),
    )
    const [hash] = await testDb.query<{ password_hash: string }>(
      `select password_hash from users where username = 'test'`,
    )
    expect(hash?.password_hash).toMatch(/^scrypt\$/)

    // Like the local seed: from this morning's 4 AM Central reset, 30 days.
    const [season, ...others] = await seasonRows()
    expect(others).toEqual([])
    expect(season).toMatchObject({ name: 'Test season', status: 'active' })
    const today = gameDay(new Date())
    expect(season?.starts_at.getTime()).toBe(gameDayStart(today).getTime())
    expect(season?.ends_at.getTime()).toBe(gameDayStart(addGameDays(today, 30)).getTime())
    seasonId = season?.id as number

    expect(await wallets(seasonId)).toEqual({ test: TEST_BALANCE, test2: TEST_BALANCE })
    // The starting balance as everyone gets it, then one top-up row each
    // (in user id order, so either account can come first).
    const rows = (await topUps(seasonId)).map((r) => [r.username, BigInt(r.delta)])
    expect(rows.sort()).toEqual([
      ['test', TEST_BALANCE - 100n * CHIP],
      ['test2', TEST_BALANCE - 100n * CHIP],
    ])
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])

    // Open pages hear about the season and both new balances.
    const names = capture.events.map((e) => e.name)
    expect(names[0]).toBe('season.state')
    expect(names.filter((n) => n === 'wallet.updated')).toHaveLength(2)
    expect(names.filter((n) => n === 'standing.changed')).toHaveLength(2)

    // The site sees the chips.
    const client = apiClient(coreApi, { deploy: PREVIEW })
    expect(
      (await client.post('/api/auth/login', { username: 'TEST2', password: 'test' })).status,
    ).toBe(200)
    const view = await client.get('/api/season')
    expect(view.body.current).toMatchObject({ id: seasonId, phase: 'open' })
    expect(view.body.wallet.balance).toBe(Number(TEST_BALANCE))
  })

  it('signing in again changes nothing while the wallets are full', async () => {
    const before = await topUps(seasonId)
    capture.events.length = 0
    expect((await signIn(PREVIEW)).status).toBe(200)
    expect(await topUps(seasonId)).toEqual(before)
    expect(await seasonRows()).toHaveLength(1)
    expect(capture.events).toEqual([])
  })

  it('fills a spent wallet back up to exactly 1,000, and a wrong password moves nothing', async () => {
    const [test] = (await testUsers()).filter((u) => u.username === 'test')
    await db().transaction((tx) =>
      debit(tx, { seasonId, userId: test?.id as string, amount: 742n * CHIP + 50n, reason: 'bet' }),
    )
    const before = await topUps(seasonId)

    const wrong = await signIn(PREVIEW, 'test', 'not the password')
    expect(wrong.status).toBe(400)
    expect(wrong.body.error.code).toBe('bad_credentials')
    expect(await topUps(seasonId)).toEqual(before)

    expect((await signIn(PREVIEW)).status).toBe(200)
    const after = await topUps(seasonId)
    expect(after.slice(before.length).map((r) => [r.username, BigInt(r.delta)])).toEqual([
      ['test', 742n * CHIP + 50n],
    ])
    expect(await wallets(seasonId)).toEqual({ test: TEST_BALANCE, test2: TEST_BALANCE })
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('two sign-ins at the same moment fill a wallet once', async () => {
    const [, test2] = await testUsers()
    await db().transaction((tx) =>
      debit(tx, { seasonId, userId: test2?.id as string, amount: 300n * CHIP, reason: 'bet' }),
    )
    const before = await topUps(seasonId)
    const both = await Promise.all([signIn(PREVIEW, 'test2'), signIn(PREVIEW, 'test')])
    expect(both.map((r) => r.status)).toEqual([200, 200])
    const added = (await topUps(seasonId)).slice(before.length)
    expect(added.map((r) => [r.username, BigInt(r.delta)])).toEqual([['test2', 300n * CHIP]])
    expect(await wallets(seasonId)).toEqual({ test: TEST_BALANCE, test2: TEST_BALANCE })
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('a wallet above 1,000 keeps what it won', async () => {
    const [test] = await testUsers()
    await testDb.query(
      `with won as (
         update wallets set balance = balance + 5000 where season_id = $1 and user_id = $2
         returning balance)
       insert into ledger (season_id, user_id, account, delta, balance_after, reason)
       select $1, $2, 'wallet', 5000, balance, 'payout' from won`,
      [seasonId, test?.id],
    )
    expect((await signIn(PREVIEW)).status).toBe(200)
    expect((await wallets(seasonId)).test).toBe(TEST_BALANCE + 5000n)
    expect(await ledgerMismatches(db(), seasonId)).toEqual([])
  })

  it('a new season after the last one ended starts where that one stopped', async () => {
    // The test season ended two hours ago.
    await testDb.query(
      `update seasons set starts_at = now() - interval '31 days', ends_at = now() - interval '2 hours',
       status = 'ended' where id = $1`,
      [seasonId],
    )
    expect((await signIn(PREVIEW)).status).toBe(200)
    const [, fresh, ...more] = await seasonRows()
    expect(more).toEqual([])
    expect(fresh).toMatchObject({ name: 'Test season', status: 'active' })
    const [ended] = await testDb.query<{ ends_at: Date }>(
      `select ends_at from seasons where id = $1`,
      [seasonId],
    )
    const reset = gameDayStart(gameDay(new Date())).getTime()
    // The next whole second after the last end, unless this morning's reset is later.
    const lastEnd = Math.ceil((ended?.ends_at as Date).getTime() / 1000) * 1000
    expect(fresh?.starts_at.getTime()).toBe(Math.max(reset, lastEnd))
    expect(await wallets(fresh?.id as number)).toEqual({ test: TEST_BALANCE, test2: TEST_BALANCE })
    expect(await ledgerMismatches(db(), fresh?.id as number)).toEqual([])
    seasonId = fresh?.id as number
  })

  it('a test season stops where the next scheduled season begins', async () => {
    await testDb.query(
      `update seasons set ends_at = now() - interval '1 hour', status = 'ended' where id = $1`,
      [seasonId],
    )
    const [scheduled] = await testDb.query<{ starts_at: Date }>(
      `insert into seasons (name, starts_at, ends_at, starting_balance, status)
       values ('Season 2', date_trunc('second', now()) + interval '3 days',
               date_trunc('second', now()) + interval '33 days', 100, 'scheduled')
       returning starts_at`,
    )
    expect((await signIn(PREVIEW)).status).toBe(200)
    const running = await testDb.query<{ name: string; ends_at: Date }>(
      `select name, ends_at from seasons where starts_at <= now() and ends_at > now()`,
    )
    expect(running).toEqual([{ name: 'Test season', ends_at: scheduled?.starts_at }])
  })
})
