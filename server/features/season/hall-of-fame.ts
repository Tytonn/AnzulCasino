/**
 * The Hall of Fame (spec: Accounts and seasons > Seasons): every finished
 * season's frozen standings, newest season first, read from season_results.
 */
import { and, asc, desc, eq, lte, ne, sql } from 'drizzle-orm'

import { seasonResults, seasons, users, wallets } from '../../../db/schema/core.ts'
import type { HallOfFame, SeasonRecord } from '../../../shared/features/season.ts'
import type { Executor } from '../../lib/db.ts'

export async function hallOfFame(executor: Executor): Promise<HallOfFame> {
  const found = await executor
    .select({
      seasonId: seasons.id,
      name: seasons.name,
      startsAt: seasons.startsAt,
      endsAt: seasons.endsAt,
      // Every place is written by one statement, so they share this time.
      frozenAt: seasonResults.createdAt,
      rank: seasonResults.finalRank,
      netWorth: seasonResults.finalNetWorth,
      userId: seasonResults.userId,
      username: users.username,
      displayName: users.displayName,
      avatar: users.avatar,
      avatarColor: users.avatarColor,
      tier: wallets.tier,
    })
    .from(seasonResults)
    .innerJoin(seasons, eq(seasons.id, seasonResults.seasonId))
    .innerJoin(users, eq(users.id, seasonResults.userId))
    .innerJoin(
      wallets,
      and(eq(wallets.seasonId, seasonResults.seasonId), eq(wallets.userId, seasonResults.userId)),
    )
    .where(eq(seasons.status, 'ended'))
    .orderBy(desc(seasons.endsAt), desc(seasons.id), asc(seasonResults.finalRank))

  const bySeason = new Map<number, SeasonRecord>()
  for (const row of found) {
    let record = bySeason.get(row.seasonId)
    if (!record) {
      record = {
        id: row.seasonId,
        name: row.name,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        frozenAt: row.frozenAt.toISOString(),
        places: [],
      }
      bySeason.set(row.seasonId, record)
    }
    record.places.push({
      rank: row.rank,
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      avatar: row.avatar,
      avatarColor: row.avatarColor,
      tier: row.tier,
      netWorth: Number(row.netWorth),
    })
  }

  const [waiting] = await executor
    .select({ id: seasons.id, name: seasons.name, endsAt: seasons.endsAt })
    .from(seasons)
    .where(and(lte(seasons.endsAt, sql`now()`), ne(seasons.status, 'ended')))
    .orderBy(desc(seasons.endsAt))
    .limit(1)

  return {
    seasons: [...bySeason.values()],
    pending: waiting
      ? { id: waiting.id, name: waiting.name, endsAt: waiting.endsAt.toISOString() }
      : null,
  }
}
