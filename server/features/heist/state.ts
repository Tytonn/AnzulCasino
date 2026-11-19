/**
 * The heist lane's rows in the core tables (docs/LANE_GUIDE.md, section 12):
 * its columns of `daily_state` (`steal_attempts_used`, `extra_steal_bought`,
 * `stolen_today`, `net_worth_at_reset`, `vault_moved`), `steals`, `shields`
 * and `shield_purchases`. Chips never move here: that is server/lib/wallet.ts.
 *
 * Lock order, in every heist transaction: the wallets first (lockWallet or
 * lockWallets, lower user id first), then the players' `daily_state` rows in
 * user id order, then their `shields` rows. Every chip-moving transaction in
 * the app locks the wallet first, so this order can never deadlock.
 */
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { dailyState, shieldPurchases, shields, steals } from '../../../db/schema/core.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import {
  attemptsAllowed,
  capLeft,
  dailyLossCap,
  type HeistState,
  seasonWeek,
  type StealView,
  type TargetInfo,
} from '../../../shared/features/heist.ts'
import { gameDay, gameDayStart, nextReset } from '../../../shared/game-day.ts'
import { seasonPhase } from '../../../shared/seasons.ts'
import type { StealOutcome } from '../../../shared/steals.ts'
import type { Wire } from '../../../shared/wire.ts'
import { type Executor, rows, type Tx } from '../../lib/db.ts'
import type { Season } from '../../lib/seasons.ts'

const HOUR_MS = 3_600_000

/** When steals, shield purchases and vault moves stop: the start of the final day. */
export function freezeStart(season: Pick<Season, 'endsAt'>, cfg: ConfigValues): Date {
  return new Date(season.endsAt.getTime() - cfg.final_freeze_hours * HOUR_MS)
}

// ---------------------------------------------------------------- daily_state

export interface DailyRow {
  userId: string
  stealAttemptsUsed: number
  extraStealBought: boolean
  stolenToday: bigint
  netWorthAtReset: bigint | null
  vaultMoved: boolean
}

const dailyColumns = {
  userId: dailyState.userId,
  stealAttemptsUsed: dailyState.stealAttemptsUsed,
  extraStealBought: dailyState.extraStealBought,
  stolenToday: dailyState.stolenToday,
  netWorthAtReset: dailyState.netWorthAtReset,
  vaultMoved: dailyState.vaultMoved,
}

/**
 * Makes each player's row for the game day if it is missing, then locks the
 * rows in user id order and returns them by user id. Lock the wallets first.
 */
export async function lockDaily(
  tx: Tx,
  seasonId: number,
  userIds: string[],
  day: string,
): Promise<Map<string, DailyRow>> {
  const ids = [...new Set(userIds)].sort()
  await tx
    .insert(dailyState)
    .values(ids.map((userId) => ({ seasonId, userId, gameDay: day })))
    .onConflictDoNothing()
  const locked = await tx
    .select(dailyColumns)
    .from(dailyState)
    .where(
      and(
        eq(dailyState.seasonId, seasonId),
        eq(dailyState.gameDay, day),
        inArray(dailyState.userId, ids),
      ),
    )
    .orderBy(dailyState.userId)
    .for('update')
  return new Map(locked.map((row) => [row.userId, row]))
}

export async function updateDaily(
  tx: Tx,
  seasonId: number,
  userId: string,
  day: string,
  set: Partial<Omit<DailyRow, 'userId'>>,
): Promise<void> {
  await tx
    .update(dailyState)
    .set(set)
    .where(
      and(
        eq(dailyState.seasonId, seasonId),
        eq(dailyState.userId, userId),
        eq(dailyState.gameDay, day),
      ),
    )
}

// ---------------------------------------------------------------- shields

export interface ShieldRow {
  charges: number
  immuneUntil: Date | null
}

/** Makes the player's shields row if it is missing, then locks it. Lock the wallet first. */
export async function lockShield(tx: Tx, seasonId: number, userId: string): Promise<ShieldRow> {
  await tx.insert(shields).values({ seasonId, userId }).onConflictDoNothing()
  const [row] = await tx
    .select({ charges: shields.charges, immuneUntil: shields.immuneUntil })
    .from(shields)
    .where(and(eq(shields.seasonId, seasonId), eq(shields.userId, userId)))
    .for('update')
  if (!row) throw new Error('The shields row was not made.')
  return row
}

export async function updateShield(
  tx: Tx,
  seasonId: number,
  userId: string,
  set: { charges?: number; immuneUntil?: Date | null },
): Promise<void> {
  await tx
    .update(shields)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(shields.seasonId, seasonId), eq(shields.userId, userId)))
}

/** Shield charges the player bought in the season week that `now` falls in. */
export async function shieldsBoughtThisWeek(
  executor: Executor,
  season: Pick<Season, 'id' | 'startsAt'>,
  userId: string,
  now: Date,
): Promise<number> {
  const week = seasonWeek(season.startsAt, now)
  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(shieldPurchases)
    .where(
      and(
        eq(shieldPurchases.seasonId, season.id),
        eq(shieldPurchases.userId, userId),
        gte(shieldPurchases.createdAt, week.start),
        lt(shieldPurchases.createdAt, week.end),
      ),
    )
  return row?.count ?? 0
}

// ---------------------------------------------------------------- net worth at the reset

/**
 * Each player's net worth at the start of the game day, from the ledger: the
 * sum of every ledger row up to the reset (both accounts, so vault moves
 * cancel out). A player who joined the season after the reset counts from
 * the moment they joined, so the season's first day and late joiners have a
 * daily loss cap too. A stored `daily_state.net_worth_at_reset` wins.
 */
function netWorthAtResetSql(seasonId: number, resetAt: Date) {
  return sql`
    select w.user_id,
      coalesce(d.net_worth_at_reset, (
        select coalesce(sum(l.delta), 0) from ledger l
        where l.season_id = w.season_id and l.user_id = w.user_id
          and l.created_at <= greatest(${resetAt.toISOString()}::timestamptz, (
            select min(f.created_at) from ledger f
            where f.season_id = w.season_id and f.user_id = w.user_id
          ))
      ))::text as net_worth_at_reset,
      coalesce(d.stolen_today, 0)::text as stolen_today,
      (extract(epoch from s.immune_until) * 1000)::float8 as immune_until_ms
    from wallets w
    left join daily_state d
      on d.season_id = w.season_id and d.user_id = w.user_id
        and d.game_day = ${gameDay(resetAt)}::date
    left join shields s on s.season_id = w.season_id and s.user_id = w.user_id
    where w.season_id = ${seasonId}`
}

interface PublicDefense {
  userId: string
  netWorthAtReset: bigint
  stolenToday: bigint
  immuneUntil: Date | null
}

/** Every player's daily cap facts and immunity: what anyone may know about them. */
export async function publicDefenses(
  executor: Executor,
  seasonId: number,
  now: Date,
): Promise<Map<string, PublicDefense>> {
  const resetAt = gameDayStart(gameDay(now))
  const found = await rows<{
    user_id: string
    net_worth_at_reset: string
    stolen_today: string
    immune_until_ms: number | string | null
  }>(executor, netWorthAtResetSql(seasonId, resetAt))
  return new Map(
    found.map((r) => [
      r.user_id,
      {
        userId: r.user_id,
        netWorthAtReset: BigInt(r.net_worth_at_reset),
        stolenToday: BigInt(r.stolen_today),
        immuneUntil: r.immune_until_ms === null ? null : new Date(Number(r.immune_until_ms)),
      },
    ]),
  )
}

/** One player's net worth at the start of the game day `now` falls in. */
export async function netWorthAtReset(
  executor: Executor,
  seasonId: number,
  userId: string,
  now: Date,
): Promise<bigint> {
  const all = await publicDefenses(executor, seasonId, now)
  return all.get(userId)?.netWorthAtReset ?? 0n
}

// ---------------------------------------------------------------- steals

export const stealColumns = {
  id: steals.id,
  seasonId: steals.seasonId,
  thiefId: steals.thiefId,
  targetId: steals.targetId,
  gameDay: steals.gameDay,
  outcome: steals.outcome,
  amount: steals.amount,
  fine: steals.fine,
  thiefRank: steals.thiefRank,
  targetRank: steals.targetRank,
  createdAt: steals.createdAt,
}

export interface StealRow {
  id: number
  seasonId: number
  thiefId: string
  targetId: string
  gameDay: string
  outcome: StealOutcome
  amount: bigint
  fine: bigint
  thiefRank: number
  targetRank: number
  createdAt: Date
}

export function stealView(row: StealRow): Wire<StealView> {
  return {
    id: row.id,
    seasonId: row.seasonId,
    thiefId: row.thiefId,
    targetId: row.targetId,
    gameDay: row.gameDay,
    outcome: row.outcome,
    amount: Number(row.amount),
    fine: Number(row.fine),
    thiefRank: row.thiefRank,
    targetRank: row.targetRank,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Whether the thief already tried this target in this game day. */
export async function triedToday(
  executor: Executor,
  seasonId: number,
  thiefId: string,
  targetId: string,
  day: string,
): Promise<boolean> {
  const [row] = await executor
    .select({ id: steals.id })
    .from(steals)
    .where(
      and(
        eq(steals.seasonId, seasonId),
        eq(steals.thiefId, thiefId),
        eq(steals.targetId, targetId),
        eq(steals.gameDay, day),
      ),
    )
    .limit(1)
  return row !== undefined
}

/** The season's latest steal attempts, newest first. */
export async function recentSteals(
  executor: Executor,
  seasonId: number,
  limit: number,
): Promise<Wire<StealView>[]> {
  const found = await executor
    .select(stealColumns)
    .from(steals)
    .where(eq(steals.seasonId, seasonId))
    .orderBy(desc(steals.createdAt), desc(steals.id))
    .limit(limit)
  return found.map(stealView)
}

// ---------------------------------------------------------------- the caller's state

/**
 * GET /api/heist/state: the caller's attempts, shields, immunity and vault
 * move for the game day, and every other player's public defenses. Nobody
 * else's shield charges are ever in it.
 */
export async function heistState(
  executor: Executor,
  season: Season | null,
  userId: string,
  cfg: ConfigValues,
  now: Date,
): Promise<Wire<HeistState>> {
  const day = gameDay(now)
  const base = {
    gameDay: day,
    nextResetAt: nextReset(now).toISOString(),
  }
  const empty: Wire<HeistState>['me'] = {
    attemptsUsed: 0,
    attemptsAllowed: cfg.steal_attempts_per_day,
    extraBought: false,
    charges: 0,
    immuneUntil: null,
    shieldsThisWeek: 0,
    weekEndsAt: null,
    vaultMoved: false,
    stolenToday: 0,
    lossCap: 0,
  }
  if (!season) {
    return { ...base, seasonId: null, phase: null, freezeAt: null, me: empty, targets: [] }
  }

  const [mine] = await executor
    .select(dailyColumns)
    .from(dailyState)
    .where(
      and(
        eq(dailyState.seasonId, season.id),
        eq(dailyState.userId, userId),
        eq(dailyState.gameDay, day),
      ),
    )
  const [shield] = await executor
    .select({ charges: shields.charges, immuneUntil: shields.immuneUntil })
    .from(shields)
    .where(and(eq(shields.seasonId, season.id), eq(shields.userId, userId)))
  const tried = await executor
    .select({ targetId: steals.targetId })
    .from(steals)
    .where(and(eq(steals.seasonId, season.id), eq(steals.thiefId, userId), eq(steals.gameDay, day)))
  const triedIds = new Set(tried.map((t) => t.targetId))
  const defenses = await publicDefenses(executor, season.id, now)
  const week = seasonWeek(season.startsAt, now)
  const own = defenses.get(userId)

  const targets: TargetInfo[] = []
  for (const d of defenses.values()) {
    if (d.userId === userId) continue
    targets.push({
      userId: d.userId,
      immuneUntil: d.immuneUntil && d.immuneUntil > now ? d.immuneUntil.toISOString() : null,
      triedToday: triedIds.has(d.userId),
      capLeft: Number(capLeft(d.netWorthAtReset, d.stolenToday, cfg.daily_loss_cap_pct)),
    })
  }

  const extraBought = mine?.extraStealBought ?? false
  return {
    ...base,
    seasonId: season.id,
    phase: seasonPhase(season, now, cfg.final_freeze_hours),
    freezeAt: freezeStart(season, cfg).toISOString(),
    me: {
      attemptsUsed: mine?.stealAttemptsUsed ?? 0,
      attemptsAllowed: attemptsAllowed(cfg.steal_attempts_per_day, extraBought),
      extraBought,
      charges: shield?.charges ?? 0,
      immuneUntil:
        shield?.immuneUntil && shield.immuneUntil > now ? shield.immuneUntil.toISOString() : null,
      shieldsThisWeek: await shieldsBoughtThisWeek(executor, season, userId, now),
      weekEndsAt: week.end.toISOString(),
      vaultMoved: mine?.vaultMoved ?? false,
      stolenToday: Number(own?.stolenToday ?? 0n),
      lossCap: Number(dailyLossCap(own?.netWorthAtReset ?? 0n, cfg.daily_loss_cap_pct)),
    },
    targets,
  }
}
