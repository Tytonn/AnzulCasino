/**
 * The player list and the ticker: what the shell needs to draw names and the
 * strip of recent results (spec: Social layer).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { gameRounds, users, wallets } from '../../db/schema/core.ts'
import type { RoundSummary } from '../../shared/events.ts'
import type { PlayerSummary } from '../../shared/players.ts'
import type { Wire } from '../../shared/wire.ts'
import { db } from '../lib/db.ts'

/** Every player who is not disabled, with their tier in `seasonId`. */
export async function listPlayers(seasonId: number | null): Promise<PlayerSummary[]> {
  return db()
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      avatarColor: users.avatarColor,
      role: users.role,
      tier: sql<PlayerSummary['tier']>`coalesce(${wallets.tier}, 'base')`,
    })
    .from(users)
    .leftJoin(wallets, and(eq(wallets.userId, users.id), eq(wallets.seasonId, seasonId ?? -1)))
    .where(isNull(users.disabledAt))
    .orderBy(users.displayName)
}

/** Rounds in the ticker when a page loads. Newer ones arrive as `round.settled`. */
export const TICKER_SIZE = 30

/** The latest settled rounds of the season, newest first, as `round.settled` sends them. */
export async function tickerRounds(seasonId: number): Promise<Wire<RoundSummary>[]> {
  const found = await db()
    .select({
      seasonId: gameRounds.seasonId,
      roundId: gameRounds.id,
      game: gameRounds.game,
      userId: gameRounds.userId,
      stake: gameRounds.stake,
      payout: gameRounds.payout,
      multiplier: sql<number | null>`round(${gameRounds.multiplier} * 100)::int`,
      summary: gameRounds.summary,
      bigBet: gameRounds.bigBet,
    })
    .from(gameRounds)
    .where(and(eq(gameRounds.seasonId, seasonId), eq(gameRounds.status, 'settled')))
    .orderBy(desc(gameRounds.settledAt), desc(gameRounds.id))
    .limit(TICKER_SIZE)
  return found.map((round) => {
    const payout = round.payout ?? 0n
    return {
      seasonId: round.seasonId,
      roundId: round.roundId,
      game: round.game,
      userId: round.userId,
      stake: Number(round.stake),
      payout: Number(payout),
      net: Number(payout - round.stake),
      multiplier: round.multiplier,
      summary: round.summary ?? '',
      bigBet: round.bigBet,
    }
  })
}
