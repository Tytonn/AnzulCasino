/**
 * Daily challenges (spec: Economy > Challenges). Each player gets
 * `challenges_per_day` per game day, picked the first time they look, from a
 * pool that only asks for what this season has shown is possible. Progress
 * is worked out from the player's settled rounds of the game day, so no game
 * has challenge code inside it. A finished challenge is claimed with one
 * click and pays `challenge_reward_min` to `challenge_reward_max` by
 * difficulty.
 */
import { and, asc, eq, gte, lt, sql } from 'drizzle-orm'

import { dailyState, gameRounds } from '../../../db/schema/core.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import {
  type ChallengeRound,
  challengePool,
  challengeProgress,
  challengeReward,
  type ChallengeView,
  pickChallenges,
  type SavedChallenge,
  type SeasonPlay,
} from '../../../shared/features/economy.ts'
import { addGameDays, gameDayStart } from '../../../shared/game-day.ts'
import { type Executor, rows, type Tx } from '../../lib/db.ts'
import { randomBelow } from '../../lib/rng.ts'

/** Each game with settled rounds this season, and the best multiplier won there. */
export async function seasonPlay(executor: Executor, seasonId: number): Promise<SeasonPlay> {
  const found = await rows<{ game: string; best: string | null }>(
    executor,
    sql`select game, max(multiplier) filter (where payout > stake) as best
        from game_rounds
        where season_id = ${seasonId} and status = 'settled'
        group by game
        order by game`,
  )
  return {
    games: found.map((r) => ({
      game: r.game,
      bestMultiplier: r.best === null ? 0 : Math.round(Number(r.best) * 100),
    })),
  }
}

/** The player's settled rounds of a game day, in the order they settled. */
export async function dayRounds(
  executor: Executor,
  seasonId: number,
  userId: string,
  day: string,
): Promise<ChallengeRound[]> {
  const found = await executor
    .select({
      game: gameRounds.game,
      stake: gameRounds.stake,
      payout: gameRounds.payout,
      multiplier: gameRounds.multiplier,
      allIn: gameRounds.allIn,
    })
    .from(gameRounds)
    .where(
      and(
        eq(gameRounds.seasonId, seasonId),
        eq(gameRounds.userId, userId),
        eq(gameRounds.status, 'settled'),
        gte(gameRounds.settledAt, gameDayStart(day)),
        lt(gameRounds.settledAt, gameDayStart(addGameDays(day, 1))),
      ),
    )
    .orderBy(asc(gameRounds.settledAt), asc(gameRounds.id))
  return found.map((r) => ({
    game: r.game,
    stake: Number(r.stake),
    payout: Number(r.payout ?? 0n),
    multiplier: r.multiplier === null ? null : Math.round(Number(r.multiplier) * 100),
    allIn: r.allIn,
  }))
}

/** Reads saved challenges, skipping anything malformed. */
export function savedChallenges(value: unknown): SavedChallenge[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (c): c is SavedChallenge =>
      !!c &&
      typeof c === 'object' &&
      typeof (c as SavedChallenge).id === 'string' &&
      typeof (c as SavedChallenge).metric === 'string' &&
      typeof (c as SavedChallenge).target === 'number' &&
      typeof (c as SavedChallenge).reward === 'number',
  )
}

/**
 * The player's challenges for a game day, picking them the first time. Two
 * requests at once pick once: only an empty list is ever overwritten.
 */
export async function ensureChallenges(
  tx: Tx,
  key: { seasonId: number; userId: string; gameDay: string },
  config: ConfigValues,
): Promise<SavedChallenge[]> {
  await tx.insert(dailyState).values(key).onConflictDoNothing()
  const where = and(
    eq(dailyState.seasonId, key.seasonId),
    eq(dailyState.userId, key.userId),
    eq(dailyState.gameDay, key.gameDay),
  )
  const [current] = await tx
    .select({ challenges: dailyState.challenges })
    .from(dailyState)
    .where(where)
  const saved = savedChallenges(current?.challenges)
  if (saved.length > 0 || config.challenges_per_day <= 0) return saved

  const pool = challengePool(await seasonPlay(tx, key.seasonId))
  const picked: SavedChallenge[] = pickChallenges(pool, config.challenges_per_day, randomBelow).map(
    (c) => ({
      ...c,
      reward: Number(
        challengeReward(c.level, config.challenge_reward_min, config.challenge_reward_max),
      ),
      claimedAt: null,
    }),
  )
  const [written] = await tx
    .update(dailyState)
    .set({ challenges: picked })
    .where(and(where, sql`${dailyState.challenges} = '[]'::jsonb`))
    .returning({ challenges: dailyState.challenges })
  if (written) return savedChallenges(written.challenges)
  // Another request picked first: use its list.
  const [again] = await tx
    .select({ challenges: dailyState.challenges })
    .from(dailyState)
    .where(where)
  return savedChallenges(again?.challenges)
}

/** Challenges as the Daily panel shows them, with progress from the day's rounds. */
export function challengeViews(
  saved: readonly SavedChallenge[],
  rounds: readonly ChallengeRound[],
): ChallengeView[] {
  return saved.map((c, index) => {
    const progress = challengeProgress(c, rounds)
    return {
      id: c.id,
      metric: c.metric,
      game: c.game,
      target: c.target,
      level: c.level,
      index,
      reward: c.reward,
      progress,
      done: progress >= c.target,
      claimed: c.claimedAt !== null,
    }
  })
}
