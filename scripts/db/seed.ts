/**
 * Sample data for local development and browser tests: an admin, three
 * players and a running season, so the site has something to show. Safe to
 * run twice. It writes through the app's own code, so every chip arrives as a
 * ledger row, the same as on the real site.
 *
 * The accounts and their password are in sample-players.ts.
 */
import { asc, eq } from 'drizzle-orm'

import { users } from '../../db/schema/core.ts'
import { addGameDays, gameDay, gameDayStart } from '../../shared/game-day.ts'
import { db, dbNow } from '../../server/lib/db.ts'
import { hashPassword } from '../../server/lib/passwords.ts'
import { createSeason, runningSeason } from '../../server/lib/seasons.ts'
import { SEED_PASSWORD, SEED_PLAYERS } from './sample-players.ts'

export interface SeedResult {
  createdUsers: string[]
  season: { id: number; name: string; created: boolean }
}

/** Seeds the database in DATABASE_URL. The caller checks that it is local. */
export async function seed(): Promise<SeedResult> {
  const passwordHash = await hashPassword(SEED_PASSWORD)
  const created = await db()
    .insert(users)
    .values(SEED_PLAYERS.map((p) => ({ ...p, passwordHash })))
    .onConflictDoNothing()
    .returning({ username: users.username })
  const createdUsers = created.map((u) => u.username)

  const running = await runningSeason()
  if (running)
    return { createdUsers, season: { id: running.id, name: running.name, created: false } }

  const [admin] = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(asc(users.createdAt))
    .limit(1)
  if (!admin) throw new Error('No admin account to create the season with.')

  // A 30-day season that began at this morning's 4 AM Central reset, so
  // today is day 1. It starts at once, giving everyone their chips.
  const today = gameDay(await dbNow(db()))
  const season = await db().transaction((tx) =>
    createSeason(tx, {
      name: 'Dev season',
      startsAt: gameDayStart(today),
      endsAt: gameDayStart(addGameDays(today, 30)),
      actorId: admin.id,
    }),
  )
  return { createdUsers, season: { id: season.id, name: season.name, created: true } }
}
