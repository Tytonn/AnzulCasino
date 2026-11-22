/**
 * Seasons from the admin panel (spec: Admin panel > Seasons: create,
 * schedule, end early). Creating and scheduling go through the foundation's
 * POST /api/seasons. This file ends a running season early and edits one
 * before it starts.
 *
 * Ending early only ever moves the end earlier: at once, or at a later time
 * that is still before the current end, which can put the season straight
 * into its final day. The economy lane's lifecycle does the rest exactly as
 * it would at the planned end: the final-day post, then freezing the
 * standings once open rounds have played out, and the podium.
 */
import { and, eq, gt, lt, ne, sql } from 'drizzle-orm'

import { seasons } from '../../../db/schema/core.ts'
import type {
  EditSeasonInput,
  EndSeasonInput,
  SeasonFields,
} from '../../../shared/features/admin.ts'
import { centralWhen, seasonEndPostText } from '../../../shared/features/admin.ts'
import { type SeasonView } from '../../../shared/seasons.ts'
import { systemPost } from '../../lib/chat.ts'
import { loadConfig } from '../../lib/config.ts'
import { db, type Tx } from '../../lib/db.ts'
import { badRequest, conflict, notFound } from '../../lib/errors.ts'
import type { AfterCommit } from '../../lib/idempotency.ts'
import { type Outgoing, publish } from '../../lib/live.ts'
import { type Season, seasonStateEvent, toSeasonView } from '../../lib/seasons.ts'
import { advanceSeasons, type SeasonRow } from '../season/lifecycle.ts'
import { forgetMoments } from '../season/moments.ts'
import { auditEvent, logAction } from './audit.ts'
import type { Actor } from './chips.ts'

const columns = {
  id: seasons.id,
  name: seasons.name,
  startsAt: seasons.startsAt,
  endsAt: seasons.endsAt,
  startingBalance: seasons.startingBalance,
  status: seasons.status,
}

/**
 * Locks a season, and the creation of seasons, for the rest of the
 * transaction: the same lock createSeason takes, so no new season can slip
 * into dates this one is moving into. Also reads the database clock.
 */
async function lockSeason(tx: Tx, id: number): Promise<{ season: Season; now: Date }> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('anzul:seasons'))`)
  const [found] = await tx
    .select({ ...columns, now: sql<string>`now()`.mapWith((v: string | Date) => new Date(v)) })
    .from(seasons)
    .where(eq(seasons.id, id))
    .for('update')
  if (!found) throw notFound('There is no such season.')
  const { now, ...season } = found
  return { season, now }
}

export interface SeasonEndResult {
  season: SeasonView
  immediate: boolean
}

/**
 * After the commit: lets the economy's lifecycle act on the new end at once,
 * as the first request after it would (the final-day post, or freezing the
 * standings and the podium once no round is open), instead of whenever the
 * next player's request finds it. This instance's remembered moments are
 * forgotten first, since the end they were worked out from has moved.
 */
async function moveSeasonOn(running: SeasonRow | null, now: Date): Promise<void> {
  try {
    forgetMoments()
    const events = await advanceSeasons(running, await loadConfig(db()), now)
    if (events.length > 0) await publish(events)
  } catch (error) {
    // The next request that checks the season does the same work.
    console.error('[admin] could not move the season on after ending it early', error)
  }
}

/** Ends a running season now, or moves its end to a time before the current one. */
export async function endSeasonEarly(
  tx: Tx,
  actor: Actor,
  seasonId: number,
  input: EndSeasonInput,
  afterCommit: AfterCommit,
): Promise<SeasonEndResult> {
  const { season, now } = await lockSeason(tx, seasonId)
  if (season.endsAt <= now) throw conflict(`${season.name} has already ended.`, 'season_over')
  if (season.startsAt > now) {
    throw conflict(
      `${season.name} has not started yet, so there is nothing to end. Change its dates instead.`,
      'season_not_started',
    )
  }
  // A time already past (a slow click on "now") means now.
  const immediate = !input.at || input.at <= now
  const endsAt = immediate ? now : (input.at as Date)
  if (endsAt >= season.endsAt) {
    throw badRequest(
      `Pick a time before the current end, ${centralWhen(season.endsAt)}. Ending early cannot make a season longer.`,
      'not_earlier',
    )
  }

  const [updated] = await tx
    .update(seasons)
    // At once: the transaction's own clock, the same now() every bet is checked against.
    .set({ endsAt: immediate ? sql`now()` : endsAt })
    .where(eq(seasons.id, season.id))
    .returning(columns)
  if (!updated) throw notFound('There is no such season.')

  const reason = input.reason ?? null
  const post = await systemPost(
    tx,
    seasonEndPostText({
      admin: actor.displayName,
      season: season.name,
      endsAt: immediate ? null : endsAt,
      reason,
    }),
    {
      tone: 'info',
      admin: {
        kind: 'season_end',
        by: actor.id,
        seasonId: season.id,
        endsAt: updated.endsAt.toISOString(),
        immediate,
        reason,
      },
    },
  )
  const entry = await logAction(tx, {
    actorId: actor.id,
    action: 'season.ended_early',
    target: `season:${season.id}`,
    before: { endsAt: season.endsAt.toISOString() },
    after: { endsAt: updated.endsAt.toISOString(), immediate },
    reason: input.reason,
    seasonId: season.id,
  })

  const { final_freeze_hours } = await loadConfig(tx)
  const view = toSeasonView(updated, now, final_freeze_hours)
  const news: Outgoing[] = [seasonStateEvent(season.id, view.phase), post, auditEvent(entry)]
  const running: SeasonRow | null = immediate
    ? null
    : {
        id: updated.id,
        name: updated.name,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        status: updated.status,
      }
  afterCommit(async () => {
    await publish(news)
    await moveSeasonOn(running, now)
  })
  return { season: view, immediate }
}

/**
 * Edits a season. Its name can change at any time; its dates and starting
 * chips only before it starts, with the same checks as creating one.
 */
export async function editSeason(
  tx: Tx,
  actor: Actor,
  seasonId: number,
  input: EditSeasonInput,
  afterCommit: AfterCommit,
): Promise<SeasonView> {
  const { season, now } = await lockSeason(tx, seasonId)
  const schedule =
    input.startsAt !== undefined ||
    input.endsAt !== undefined ||
    input.startingBalance !== undefined
  if (schedule && (season.status !== 'scheduled' || season.startsAt <= now)) {
    throw conflict(
      `${season.name} has already started, so only its name can change. To finish it sooner, end it early.`,
      'season_started',
    )
  }

  if (schedule) {
    const startsAt = input.startsAt ?? season.startsAt
    const endsAt = input.endsAt ?? season.endsAt
    if (startsAt <= now) throw badRequest('The season must start in the future.', 'starts_in_past')
    if (endsAt <= startsAt)
      throw badRequest('The season must end after it starts.', 'ends_before_start')
    const [clash] = await tx
      .select({ name: seasons.name })
      .from(seasons)
      .where(
        and(ne(seasons.id, season.id), lt(seasons.startsAt, endsAt), gt(seasons.endsAt, startsAt)),
      )
      .limit(1)
    if (clash) {
      throw conflict(`That overlaps ${clash.name}. Seasons cannot overlap.`, 'season_overlap')
    }
  }

  const before: SeasonFields = {}
  const after: SeasonFields = {}
  const set: Partial<{ name: string; startsAt: Date; endsAt: Date; startingBalance: bigint }> = {}
  if (input.name !== undefined && input.name !== season.name) {
    before.name = season.name
    after.name = input.name
    set.name = input.name
  }
  if (input.startsAt && input.startsAt.getTime() !== season.startsAt.getTime()) {
    before.startsAt = season.startsAt.toISOString()
    after.startsAt = input.startsAt.toISOString()
    set.startsAt = input.startsAt
  }
  if (input.endsAt && input.endsAt.getTime() !== season.endsAt.getTime()) {
    before.endsAt = season.endsAt.toISOString()
    after.endsAt = input.endsAt.toISOString()
    set.endsAt = input.endsAt
  }
  if (
    input.startingBalance !== undefined &&
    BigInt(input.startingBalance) !== season.startingBalance
  ) {
    before.startingBalance = Number(season.startingBalance)
    after.startingBalance = input.startingBalance
    set.startingBalance = BigInt(input.startingBalance)
  }

  const { final_freeze_hours } = await loadConfig(tx)
  if (Object.keys(set).length === 0) return toSeasonView(season, now, final_freeze_hours)

  const [updated] = await tx
    .update(seasons)
    .set(set)
    .where(eq(seasons.id, season.id))
    .returning(columns)
  if (!updated) throw notFound('There is no such season.')
  const entry = await logAction(tx, {
    actorId: actor.id,
    action: 'season.updated',
    target: `season:${season.id}`,
    before,
    after,
    seasonId: season.id,
  })
  const view = toSeasonView(updated, now, final_freeze_hours)
  afterCommit(() => publish([seasonStateEvent(season.id, view.phase), auditEvent(entry)]))
  return view
}
