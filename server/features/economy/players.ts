/**
 * The rows the economy keeps per player: `economy_players` (when rank income
 * was last collected, and the version of the player's economy) and
 * `daily_state` (the streak bonus, challenges and the rank bought today).
 * Lock the wallet first, then these, in that order, so two of the player's
 * requests never wait on each other the other way round.
 */
import { and, eq, sql } from 'drizzle-orm'

import { dailyState } from '../../../db/schema/core.ts'
import { economyPlayers } from '../../../db/schema/economy.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import { type Executor, rows, type Tx } from '../../lib/db.ts'
import { ApiError } from '../../lib/errors.ts'

// ---------------------------------------------------------------- the season's clock

export function noSeason(): ApiError {
  return new ApiError(409, 'no_season', 'There is no season running right now.')
}

/**
 * Refuses unless the season is running by the transaction's own clock (rule
 * 8): from its start until its end. Tells the caller whether its final day
 * has begun.
 */
export async function requireSeasonRunning(
  tx: Tx,
  seasonId: number,
  config: ConfigValues,
): Promise<{ finalDay: boolean }> {
  const [row] = await rows<{
    started: boolean
    ended: boolean
    final_day: boolean
    status: string
  }>(
    tx,
    sql`select now() >= starts_at as started, now() >= ends_at as ended,
          now() >= ends_at - make_interval(hours => ${config.final_freeze_hours}) as final_day,
          status
        from seasons where id = ${seasonId}`,
  )
  if (!row) throw noSeason()
  if (row.ended) {
    throw new ApiError(409, 'season_over', 'This season is over. The next one starts fresh.')
  }
  if (!row.started || row.status === 'scheduled') {
    throw new ApiError(409, 'season_not_started', 'The season has not started yet.')
  }
  return { finalDay: row.final_day }
}

// ---------------------------------------------------------------- economy_players

export interface EconomyPlayer {
  /** When income started to build: the last collect, or the player's start in the season. */
  since: Date
  /** Milliseconds since then, by the database clock. */
  elapsedMs: bigint
  version: number
}

/**
 * The player's income clock. Without a collect yet, income builds from the
 * later of the season's start and the player's signup, so a late joiner gets
 * no income for days before they existed.
 */
export async function incomeClock(
  executor: Executor,
  seasonId: number,
  userId: string,
): Promise<EconomyPlayer | null> {
  const [row] = await rows<{ since_ms: string; elapsed_ms: string; version: string }>(
    executor,
    sql`select
          floor(extract(epoch from since) * 1000)::bigint as since_ms,
          greatest(0, floor(extract(epoch from now() - since) * 1000))::bigint as elapsed_ms,
          version
        from (
          select coalesce(e.collected_at, greatest(s.starts_at, u.created_at)) as since,
            coalesce(e.version, 0) as version
          from wallets w
          join seasons s on s.id = w.season_id
          join users u on u.id = w.user_id
          left join economy_players e on e.season_id = w.season_id and e.user_id = w.user_id
          where w.season_id = ${seasonId} and w.user_id = ${userId}
        ) clock`,
  )
  if (!row) return null
  return {
    since: new Date(Number(row.since_ms)),
    elapsedMs: BigInt(row.elapsed_ms),
    version: Number(row.version),
  }
}

/** Makes the player's row if it is missing, and locks it. Lock the wallet first. */
export async function lockEconomyPlayer(tx: Tx, seasonId: number, userId: string): Promise<void> {
  await tx.insert(economyPlayers).values({ seasonId, userId }).onConflictDoNothing()
  await tx
    .select({ version: economyPlayers.version })
    .from(economyPlayers)
    .where(and(eq(economyPlayers.seasonId, seasonId), eq(economyPlayers.userId, userId)))
    .for('update')
}

/** Starts income building again from now: after a collect, or a rank bought. */
export async function restartIncomeClock(tx: Tx, seasonId: number, userId: string): Promise<void> {
  await tx
    .update(economyPlayers)
    .set({ collectedAt: sql`now()` })
    .where(and(eq(economyPlayers.seasonId, seasonId), eq(economyPlayers.userId, userId)))
}

/**
 * Counts one more change to the player's economy and returns the new
 * version, for the `economy.changed` event. Call it once per request.
 */
export async function bumpVersion(tx: Tx, seasonId: number, userId: string): Promise<number> {
  const [row] = await tx
    .insert(economyPlayers)
    .values({ seasonId, userId, version: 1 })
    .onConflictDoUpdate({
      target: [economyPlayers.seasonId, economyPlayers.userId],
      set: { version: sql`${economyPlayers.version} + 1` },
    })
    .returning({ version: economyPlayers.version })
  return row?.version ?? 0
}

// ---------------------------------------------------------------- daily_state

export interface DailyRow {
  gameDay: string
  bonusClaimed: boolean
  streak: number
  tierBought: boolean
  challenges: unknown
}

const dailyColumns = {
  gameDay: dailyState.gameDay,
  bonusClaimed: dailyState.bonusClaimed,
  streak: dailyState.streak,
  tierBought: dailyState.tierBought,
  challenges: dailyState.challenges,
}

/** Makes the player's row for a game day if it is missing, and locks it. Lock the wallet first. */
export async function lockDaily(
  tx: Tx,
  seasonId: number,
  userId: string,
  gameDay: string,
): Promise<DailyRow> {
  await tx.insert(dailyState).values({ seasonId, userId, gameDay }).onConflictDoNothing()
  const [row] = await tx
    .select(dailyColumns)
    .from(dailyState)
    .where(
      and(
        eq(dailyState.seasonId, seasonId),
        eq(dailyState.userId, userId),
        eq(dailyState.gameDay, gameDay),
      ),
    )
    .for('update')
  if (!row) throw new Error('The daily row was not made')
  return row
}

/** Reads the player's row for a game day, or null. */
export async function readDaily(
  executor: Executor,
  seasonId: number,
  userId: string,
  gameDay: string,
): Promise<DailyRow | null> {
  const [row] = await executor
    .select(dailyColumns)
    .from(dailyState)
    .where(
      and(
        eq(dailyState.seasonId, seasonId),
        eq(dailyState.userId, userId),
        eq(dailyState.gameDay, gameDay),
      ),
    )
  return row ?? null
}

/** Changes the economy's columns on the player's row for a game day. */
export async function updateDaily(
  tx: Tx,
  key: { seasonId: number; userId: string; gameDay: string },
  set: Partial<Pick<DailyRow, 'bonusClaimed' | 'streak' | 'tierBought' | 'challenges'>>,
): Promise<void> {
  await tx
    .update(dailyState)
    .set(set)
    .where(
      and(
        eq(dailyState.seasonId, key.seasonId),
        eq(dailyState.userId, key.userId),
        eq(dailyState.gameDay, key.gameDay),
      ),
    )
}
