/**
 * The player list and the ticker: what the shell needs to draw names and the
 * strip of recent results and steal attempts (spec: Social layer; Steal
 * rules, rule 7).
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { gameRounds, steals, users, wallets } from '../../db/schema/core.ts'
import type { RoundSummary } from '../../shared/events.ts'
import type { PlayerSummary } from '../../shared/players.ts'
import type { StealView } from '../../shared/steals.ts'
import type { TickerItem } from '../../shared/ticker.ts'
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

/**
 * Items in the ticker when a page loads, rounds and steal attempts together.
 * Newer ones arrive as `round.settled` and `steal.result`.
 */
export const TICKER_SIZE = 30

/**
 * The latest settled rounds and steal attempts of the season, newest first,
 * as `round.settled` and `steal.result` send them.
 */
export async function tickerItems(seasonId: number): Promise<TickerItem[]> {
  const rounds = await db()
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
      settledAt: gameRounds.settledAt,
    })
    .from(gameRounds)
    .where(and(eq(gameRounds.seasonId, seasonId), eq(gameRounds.status, 'settled')))
    .orderBy(desc(gameRounds.settledAt), desc(gameRounds.id))
    .limit(TICKER_SIZE)
  const attempts = await db()
    .select()
    .from(steals)
    .where(eq(steals.seasonId, seasonId))
    .orderBy(desc(steals.createdAt), desc(steals.id))
    .limit(TICKER_SIZE)

  const dated: { at: number; item: TickerItem }[] = []
  for (const round of rounds) {
    const payout = round.payout ?? 0n
    const summary: Wire<RoundSummary> = {
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
    dated.push({ at: round.settledAt?.getTime() ?? 0, item: { kind: 'round', round: summary } })
  }
  for (const steal of attempts) {
    dated.push({ at: steal.createdAt.getTime(), item: { kind: 'steal', steal: stealView(steal) } })
  }
  // Newest first. The sort is stable, so each kind keeps its own order on a tie.
  dated.sort((a, b) => b.at - a.at)
  return dated.slice(0, TICKER_SIZE).map(({ item }) => item)
}

/** A steal row as the ticker and `steal.result` send it. */
function stealView(row: typeof steals.$inferSelect): Wire<StealView> {
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
