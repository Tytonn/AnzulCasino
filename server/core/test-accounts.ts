/**
 * The test accounts (shared/test-accounts.ts): `test` and `test2`, password
 * `test`, for trying the site without an invite code or a long password.
 *
 * They are on only where the database is a copy: a deploy preview or a
 * branch deploy (each gets its own copy of the database, made from
 * production when it is first built) and local development. Production
 * deploys, published or not, use the live database, so there they are off
 * and those usernames are ordinary ones: signing in as `test` there needs
 * that account's own password, like any other, and creates nothing.
 *
 * Where they are on, signing in as either one:
 * - creates both if they are missing, with the test password;
 * - starts a 30-day test season if none is running, like the local seed;
 * - puts both in the season and fills each wallet back up to TEST_BALANCE
 *   with one `admin_adjust` ledger row, so a tester who goes broke only has
 *   to sign in again. A wallet already at or above it is left alone, so a
 *   repeated sign-in changes nothing.
 */
import { and, asc, desc, gt, inArray, isNull, lte, sql } from 'drizzle-orm'

import { seasons, users } from '../../db/schema/core.ts'
import { addGameDays, gameDay, gameDayStart } from '../../shared/game-day.ts'
import { seasonPhase } from '../../shared/seasons.ts'
import { TEST_ACCOUNTS, TEST_BALANCE, TEST_PASSWORD } from '../../shared/test-accounts.ts'
import { loadConfig } from '../lib/config.ts'
import { db, dbNow, type Tx } from '../lib/db.ts'
import { type Outgoing, publish, walletEvents } from '../lib/live.ts'
import { hashPassword } from '../lib/passwords.ts'
import {
  createSeason,
  joinSeason,
  runningSeason,
  type Season,
  seasonStateEvent,
  startedSeason,
} from '../lib/seasons.ts'
import { credit, lockWallet } from '../lib/wallet.ts'

/** Netlify's `context.deploy`: which deploy is answering the request. */
export interface DeployInfo {
  context: string
  id: string
  published: boolean
}

/** Deploy contexts whose database is a copy, never the live one. */
const COPY_CONTEXTS = new Set(['deploy-preview', 'branch-deploy', 'dev'])

/**
 * Whether the test accounts work on this deploy. Off unless Netlify says it
 * is a deploy preview, a branch deploy or local development, and never on the
 * published deploy, so the live site cannot have them whatever else is true.
 */
export function testAccountsOn(deploy: DeployInfo | null | undefined): boolean {
  return !!deploy && COPY_CONTEXTS.has(deploy.context) && deploy.published !== true
}

const USERNAMES: string[] = TEST_ACCOUNTS.map((a) => a.username)
const lowerUsername = sql`lower(${users.username})`

/** The test season's length, as the local seed and the preview setup make it. */
const SEASON_DAYS = 30

/**
 * Creates whichever test accounts are missing. Runs before the password
 * check, so the very first sign-in on a fresh preview works.
 */
export async function ensureTestAccounts(): Promise<void> {
  const found = await db()
    .select({ username: sql<string>`${lowerUsername}` })
    .from(users)
    .where(inArray(lowerUsername, USERNAMES))
  const have = new Set(found.map((u) => u.username))
  const missing = TEST_ACCOUNTS.filter((a) => !have.has(a.username))
  if (missing.length === 0) return
  const passwordHash = await hashPassword(TEST_PASSWORD)
  await db()
    .insert(users)
    .values(missing.map((a) => ({ ...a, passwordHash })))
    // Two first sign-ins at once: the later insert finds the account there.
    .onConflictDoNothing()
}

/**
 * After a test account has signed in: a running season, both accounts in
 * it, and both wallets filled back up to TEST_BALANCE. One transaction under
 * one lock, so two sign-ins at the same moment fill each wallet once.
 * `actorId` is whoever signed in, recorded as the maker of a new season.
 */
export async function refillTestAccounts(actorId: string): Promise<void> {
  // Starts a season whose start time has come, as any page load would.
  await runningSeason()
  const done = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('anzul:test-accounts'))`)
    const started = await startedSeason(tx)
    const season = started ?? (await createTestSeason(tx, actorId))
    if (!season) return null

    const accounts = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(lowerUsername, USERNAMES), isNull(users.disabledAt)))
      // Wallets lock in user id order, the order that cannot deadlock.
      .orderBy(users.id)
    const events: Outgoing[] = []
    for (const account of accounts) {
      const joined = await joinSeason(tx, season, account.id)
      const wallet = await lockWallet(tx, season.id, account.id)
      const short = TEST_BALANCE - wallet.balance
      const after =
        short > 0n
          ? await credit(tx, {
              seasonId: season.id,
              userId: account.id,
              amount: short,
              reason: 'admin_adjust',
              refType: 'test_account',
              meta: { testAccount: true },
            })
          : joined
      if (after) events.push(...walletEvents(season.id, account.id, after))
    }
    return { season, created: !started, events }
  })
  if (!done) return

  // After the commit: everyone's leaderboard shows the new chips, and a new
  // season makes every open page fetch the season again.
  const news = done.events
  if (done.created) {
    const { final_freeze_hours } = await loadConfig(db())
    const phase = seasonPhase(done.season, await dbNow(db()), final_freeze_hours)
    news.unshift(seasonStateEvent(done.season.id, phase))
  }
  await publish(news)
}

/**
 * A test season like the local seed's: from this morning's 4 AM Central reset
 * for 30 days, but never overlapping another season. It starts after the
 * last one that ended and stops where the next scheduled one begins. Null
 * when there is no room (the next season starts this very moment).
 */
async function createTestSeason(tx: Tx, actorId: string): Promise<Season | null> {
  const now = await dbNow(tx)
  const today = gameDay(now)
  const [ended] = await tx
    .select({ endsAt: seasons.endsAt })
    .from(seasons)
    .where(lte(seasons.endsAt, sql`now()`))
    .orderBy(desc(seasons.endsAt))
    .limit(1)
  const [next] = await tx
    .select({ startsAt: seasons.startsAt })
    .from(seasons)
    .where(gt(seasons.startsAt, sql`now()`))
    .orderBy(asc(seasons.startsAt))
    .limit(1)

  const reset = gameDayStart(today)
  // Up to the next whole second: Postgres keeps microseconds that a Date drops,
  // and a start a fraction before the last end would overlap it.
  const lastEnd = ended && new Date(Math.ceil(ended.endsAt.getTime() / 1000) * 1000)
  const startsAt = lastEnd && lastEnd > reset ? lastEnd : reset
  const fullLength = gameDayStart(addGameDays(today, SEASON_DAYS))
  const endsAt = next && next.startsAt < fullLength ? next.startsAt : fullLength
  if (endsAt <= now) return null
  return createSeason(tx, { name: 'Test season', startsAt, endsAt, actorId })
}
