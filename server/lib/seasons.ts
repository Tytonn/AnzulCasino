/**
 * Seasons on the server (spec: Accounts and seasons > Seasons): create one,
 * find the one running, give starting balances (late joiners too), close
 * betting at the end time by database time, and rank the players.
 *
 * Nothing runs on a timer, so the database can sleep. A season starts on the
 * first request that finds its start time has passed: every player who is not
 * disabled gets a wallet with the starting balance, one `season_start` ledger
 * row each. Anyone who arrives later gets the same amount when they sign up
 * or next load the site.
 *
 * The economy lane owns the final day, the podium, the Hall of Fame and
 * freezing the final standings.
 */
import { and, asc, desc, eq, gt, isNull, lt, lte, sql } from 'drizzle-orm'

import { seasons, users, wallets } from '../../db/schema/core.ts'
import {
  type SeasonPhase,
  type SeasonStatus,
  type SeasonView,
  seasonPhase,
} from '../../shared/seasons.ts'
import type { Tier } from '../../shared/tiers.ts'
import { writeAudit } from './audit.ts'
import { loadConfig } from './config.ts'
import { db, dbNow, type Executor, type Tx } from './db.ts'
import { ApiError, badRequest, conflict } from './errors.ts'
import { liveEvent, type Outgoing, publish, walletEvents } from './live.ts'
import { type Balances, credit, readWallet, type Wallet, walletVersion } from './wallet.ts'

export interface Season {
  id: number
  name: string
  startsAt: Date
  endsAt: Date
  /** Hundredths. */
  startingBalance: bigint
  status: SeasonStatus
}

const seasonColumns = {
  id: seasons.id,
  name: seasons.name,
  startsAt: seasons.startsAt,
  endsAt: seasons.endsAt,
  startingBalance: seasons.startingBalance,
  status: seasons.status,
}

export function toSeasonView(season: Season, now: Date, finalFreezeHours: number): SeasonView {
  return {
    id: season.id,
    name: season.name,
    startsAt: season.startsAt.toISOString(),
    endsAt: season.endsAt.toISOString(),
    startingBalance: Number(season.startingBalance),
    status: season.status,
    phase: seasonPhase(season, now, finalFreezeHours),
  }
}

/**
 * The news that a season was created, started or changed, for every browser:
 * each one refetches the season, its wallet and the leaderboard.
 */
export function seasonStateEvent(seasonId: number, phase: SeasonPhase): Outgoing {
  return liveEvent('feed', 'season.state', { seasonId, phase })
}

export interface NewSeason {
  name: string
  startsAt: Date
  endsAt: Date
  /** Hundredths. Defaults to the starting_balance setting. */
  startingBalance?: bigint
  actorId: string
}

/**
 * Creates a season. Seasons never overlap. One whose start time has already
 * passed starts at once.
 */
export async function createSeason(tx: Tx, input: NewSeason): Promise<Season> {
  if (input.endsAt <= input.startsAt) throw badRequest('The season must end after it starts.')
  // One creation at a time, so two overlapping seasons cannot both pass the check.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('anzul:seasons'))`)

  const now = await dbNow(tx)
  if (input.endsAt <= now) throw badRequest('The season must end in the future.')

  const [clash] = await tx
    .select({ name: seasons.name })
    .from(seasons)
    .where(and(lt(seasons.startsAt, input.endsAt), gt(seasons.endsAt, input.startsAt)))
    .limit(1)
  if (clash)
    throw conflict(`That overlaps ${clash.name}. Seasons cannot overlap.`, 'season_overlap')

  const startingBalance = input.startingBalance ?? (await loadConfig(tx)).starting_balance
  const [created] = await tx
    .insert(seasons)
    .values({
      name: input.name,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      startingBalance,
      status: 'scheduled',
      createdBy: input.actorId,
    })
    .returning(seasonColumns)
  const season = created as Season

  await writeAudit(tx, {
    actorId: input.actorId,
    action: 'season.created',
    target: `season:${season.id}`,
    after: {
      name: season.name,
      startsAt: season.startsAt.toISOString(),
      endsAt: season.endsAt.toISOString(),
      startingBalance: season.startingBalance,
    },
    seasonId: season.id,
  })

  if (season.startsAt <= now) return (await startSeason(tx, season.id)) ?? season
  return season
}

/**
 * Gives a player their wallet and starting balance in a season, once. Returns
 * the new balances, or null if they already had a wallet. Publish
 * walletEvents() for them after the commit.
 */
export async function joinSeason(tx: Tx, season: Season, userId: string): Promise<Balances | null> {
  const [created] = await tx
    .insert(wallets)
    .values({ seasonId: season.id, userId })
    .onConflictDoNothing()
    .returning({ userId: wallets.userId })
  if (!created) return null
  return credit(tx, {
    seasonId: season.id,
    userId,
    amount: season.startingBalance,
    reason: 'season_start',
    refType: 'season',
    refId: season.id,
  })
}

/**
 * Starts a scheduled season whose start time has passed: marks it active and
 * gives every player who is not disabled their starting balance. Returns null
 * if there was nothing to start (another request got there first).
 */
async function startSeason(tx: Tx, seasonId: number): Promise<Season | null> {
  const [started] = await tx
    .update(seasons)
    .set({ status: 'active' })
    .where(
      and(
        eq(seasons.id, seasonId),
        eq(seasons.status, 'scheduled'),
        lte(seasons.startsAt, sql`now()`),
      ),
    )
    .returning(seasonColumns)
  if (!started) return null
  const players = await tx
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.disabledAt))
    .orderBy(users.id)
  for (const player of players) await joinSeason(tx, started, player.id)
  return started
}

/** The season whose start time has passed and end time has not, as stored. */
async function findRunning(executor: Executor): Promise<Season | null> {
  const [found] = await executor
    .select(seasonColumns)
    .from(seasons)
    .where(and(lte(seasons.startsAt, sql`now()`), gt(seasons.endsAt, sql`now()`)))
    .orderBy(desc(seasons.startsAt))
    .limit(1)
  return found ?? null
}

/**
 * The season running now, starting it first if its time has just come. Call
 * it before your transaction, then check `requireBetsOpen` inside it.
 */
export async function runningSeason(): Promise<Season | null> {
  const found = await findRunning(db())
  if (!found || found.status !== 'scheduled') return found
  const started = await db().transaction((tx) => startSeason(tx, found.id))
  if (!started) return findRunning(db())
  // Only the request that started it gets here, once per season.
  const { final_freeze_hours } = await loadConfig(db())
  const phase = seasonPhase(started, await dbNow(db()), final_freeze_hours)
  await publish([seasonStateEvent(started.id, phase)])
  return started
}

/**
 * Inside a transaction: the running season if it has been started. Signup uses
 * it to give a late joiner their starting balance in the same transaction.
 */
export async function startedSeason(tx: Tx): Promise<Season | null> {
  const found = await findRunning(tx)
  return found && found.status !== 'scheduled' ? found : null
}

/**
 * Refuses a new bet unless the season takes bets right now by the
 * transaction's own clock (rules 8 and "the end is exact"). Call it inside the
 * transaction that takes the stake. Rounds already open still settle.
 */
export async function requireBetsOpen(tx: Tx, seasonId: number): Promise<void> {
  const [row] = await tx
    .select({
      started: sql<boolean>`now() >= ${seasons.startsAt}`,
      ended: sql<boolean>`now() >= ${seasons.endsAt}`,
      status: seasons.status,
    })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
  if (!row) throw new ApiError(409, 'no_season', 'There is no season running right now.')
  if (row.ended) {
    throw new ApiError(409, 'season_over', 'This season has ended, so bets are closed.')
  }
  if (!row.started || row.status === 'scheduled') {
    throw new ApiError(409, 'season_not_started', 'The season has not started yet.')
  }
}

/** The running season, or else the last one that ended. */
export async function currentSeason(): Promise<Season | null> {
  return (await runningSeason()) ?? (await lastEnded(db()))
}

/** The last season that has ended. */
async function lastEnded(executor: Executor): Promise<Season | null> {
  const [found] = await executor
    .select(seasonColumns)
    .from(seasons)
    .where(lte(seasons.endsAt, sql`now()`))
    .orderBy(desc(seasons.endsAt))
    .limit(1)
  return found ?? null
}

/** The next season that has not started. */
async function nextScheduled(executor: Executor): Promise<Season | null> {
  const [found] = await executor
    .select(seasonColumns)
    .from(seasons)
    .where(gt(seasons.startsAt, sql`now()`))
    .orderBy(asc(seasons.startsAt))
    .limit(1)
  return found ?? null
}

export interface SeasonSnapshot {
  current: Season | null
  next: Season | null
  /** `version` is the wallet's latest ledger id, as its live events carry. */
  wallet: (Wallet & { version: number }) | null
}

/**
 * What the shell shows on load: the running season (or the last one), the
 * next one, and the player's wallet. A player without a wallet in the running
 * season gets one now, with the starting balance.
 */
export async function seasonSnapshot(userId: string): Promise<SeasonSnapshot> {
  const running = await runningSeason()
  const current = running ?? (await lastEnded(db()))
  const next = await nextScheduled(db())
  let wallet = current ? await readWallet(db(), current.id, userId) : null
  if (running && !wallet) {
    const joined = await db().transaction((tx) => joinSeason(tx, running, userId))
    if (joined) await publish(walletEvents(running.id, userId, joined))
    wallet = await readWallet(db(), running.id, userId)
  }
  return { current, next, wallet }
}

export async function listSeasons(executor: Executor): Promise<Season[]> {
  return executor.select(seasonColumns).from(seasons).orderBy(desc(seasons.startsAt))
}

export interface Standing {
  /** 1 is first. Players level on net worth and on when they reached it share a rank. */
  rank: number
  userId: string
  username: string
  displayName: string
  avatar: string
  avatarColor: string
  tier: Tier
  balance: bigint
  vault: bigint
  netWorth: bigint
  /** The wallet's latest ledger id: `standing.changed` events older than this are stale. */
  version: number
}

/**
 * The leaderboard: net worth (wallet plus vault), highest first. A tie goes
 * to whoever reached that net worth first. Disabled accounts are left out.
 */
export async function standings(executor: Executor, seasonId: number): Promise<Standing[]> {
  const worth = sql`${wallets.balance} + ${wallets.vault}`
  const found = await executor
    .select({
      rank: sql<number>`(rank() over (order by ${worth} desc, ${wallets.netWorthAt} asc))::int`,
      userId: wallets.userId,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      avatarColor: users.avatarColor,
      tier: wallets.tier,
      balance: wallets.balance,
      vault: wallets.vault,
      version: walletVersion,
    })
    .from(wallets)
    .innerJoin(users, eq(users.id, wallets.userId))
    .where(and(eq(wallets.seasonId, seasonId), isNull(users.disabledAt)))
    .orderBy(desc(worth), asc(wallets.netWorthAt), asc(users.displayName))
  return found.map((row) => ({ ...row, netWorth: row.balance + row.vault }))
}
