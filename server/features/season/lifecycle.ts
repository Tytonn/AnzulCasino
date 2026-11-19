/**
 * A season's last day and its end (spec: Accounts and seasons > Seasons),
 * moved on by requests instead of timers, so the database can sleep:
 *
 * - **The final day.** The first request in the last `final_freeze_hours`
 *   sets the status to `final_day`, posts it in chat and tells every browser
 *   (`season.state`). Browsers draw the banner from the clock, so it shows on
 *   time even before that request.
 * - **The end.** No bet is taken at or after the end time (the round helper
 *   refuses it). The first request after the end freezes the standings into
 *   `season_results` once no round is still open, or `round_timeout_minutes`
 *   after the end, whichever comes first, so a hand dealt before the end
 *   still counts. Then the status becomes `ended`, the podium is posted in
 *   chat, and every browser hears `season.state`.
 *
 * Places are numbered by net worth (wallet plus vault), and a tie goes to
 * whoever reached that net worth first, as on the leaderboard. Disabled
 * accounts are left out. Frozen standings never change.
 */
import { and, asc, desc, eq, lte, ne, sql } from 'drizzle-orm'

import { seasons } from '../../../db/schema/core.ts'
import { formatChips } from '../../../shared/chips.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import { finalDayStartsAt, medal } from '../../../shared/features/season.ts'
import type { SeasonStatus } from '../../../shared/seasons.ts'
import { db, rows, type Tx } from '../../lib/db.ts'
import type { Outgoing } from '../../lib/live.ts'
import { seasonStateEvent } from '../../lib/seasons.ts'
import { announce } from './announce.ts'
import { dueAt, isDue } from './moments.ts'

export interface SeasonRow {
  id: number
  name: string
  startsAt: Date
  endsAt: Date
  status: SeasonStatus
}

const seasonColumns = {
  id: seasons.id,
  name: seasons.name,
  startsAt: seasons.startsAt,
  endsAt: seasons.endsAt,
  status: seasons.status,
}

/** A podium post for a season that ended longer ago than this is no longer news. */
const STALE_END_MS = 3 * 24 * 3_600_000

/**
 * Moves seasons on: the running one into its final day, the last ended one
 * to `ended` with frozen standings. Returns the events to publish after it.
 * Call it from requests every browser makes; it costs no query until a
 * moment is due.
 */
export async function advanceSeasons(
  running: SeasonRow | null,
  config: ConfigValues,
  now: Date,
): Promise<Outgoing[]> {
  const events: Outgoing[] = []
  if (running) events.push(...(await enterFinalDay(running, config, now)))
  events.push(...(await finishEndedSeason(running, config, now)))
  return events
}

// ---------------------------------------------------------------- the final day

const HOUR_MS = 3_600_000
const MINUTE_MS = 60_000

/** "12 hours", "about an hour", "40 minutes": what is left when the post goes up. */
function timeLeftText(leftMs: number): string {
  const hours = Math.round(leftMs / HOUR_MS)
  if (hours >= 2) return `${hours} hours`
  if (leftMs >= 45 * MINUTE_MS) return 'about an hour'
  const minutes = Math.max(1, Math.round(leftMs / MINUTE_MS))
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/**
 * The post for the final day. It goes up on the first request in the final
 * day, which may come hours in, so it says what is actually left.
 */
export function finalDayText(name: string, leftMs: number): string {
  return (
    `⏳ The final day of ${name} has begun: ${timeLeftText(leftMs)} to go. Steals, shields, ` +
    'vault moves and rank purchases are off now. The games stay open right to the end.'
  )
}

async function enterFinalDay(
  season: SeasonRow,
  config: ConfigValues,
  now: Date,
): Promise<Outgoing[]> {
  const key = `final:${season.id}`
  if (season.status !== 'active' || !isDue(key, now)) return []
  const startsAt = finalDayStartsAt(season.endsAt, config.final_freeze_hours)
  if (now < startsAt) {
    dueAt(key, startsAt, now)
    return []
  }
  const events = await db().transaction(async (tx) => {
    const [moved] = await tx
      .update(seasons)
      .set({ status: 'final_day' })
      .where(
        and(
          eq(seasons.id, season.id),
          eq(seasons.status, 'active'),
          sql`now() >= ${seasons.endsAt} - make_interval(hours => ${config.final_freeze_hours})`,
          sql`now() < ${seasons.endsAt}`,
        ),
      )
      .returning({ id: seasons.id })
    if (!moved) return []
    const post = await announce(tx, {
      seasonId: season.id,
      key: 'final_day',
      body: finalDayText(season.name, season.endsAt.getTime() - now.getTime()),
    })
    return [seasonStateEvent(season.id, 'final_day'), ...post]
  })
  dueAt(key, null, now)
  return events
}

// ---------------------------------------------------------------- the end

export interface FrozenPlace {
  rank: number
  userId: string
  displayName: string
  netWorth: bigint
}

export function podiumText(name: string, places: readonly FrozenPlace[]): string {
  const top = places
    .slice(0, 3)
    .map((p) => `${medal(p.rank) ?? `#${p.rank}`} ${p.displayName} ${formatChips(p.netWorth)}`)
  if (top.length === 0) return `🏁 ${name} is over.`
  return `🏁 ${name} is over! ${top.join(' · ')}. Every place is in the Hall of Fame.`
}

/**
 * Copies the standings into season_results, best first. Locks the season's
 * wallets first, so a payout still committing is either in or waits.
 */
export async function freezeStandings(tx: Tx, seasonId: number): Promise<FrozenPlace[]> {
  await tx.execute(
    sql`select 1 from wallets where season_id = ${seasonId} order by user_id for update`,
  )
  await tx.execute(sql`
    insert into season_results (season_id, user_id, final_rank, final_net_worth)
    select w.season_id, w.user_id,
      row_number() over (order by w.balance + w.vault desc, w.net_worth_at asc, w.user_id asc),
      w.balance + w.vault
    from wallets w
    join users u on u.id = w.user_id
    where w.season_id = ${seasonId} and u.disabled_at is null
    on conflict do nothing`)
  const found = await rows<{
    final_rank: number
    user_id: string
    display_name: string
    final_net_worth: string
  }>(
    tx,
    sql`select r.final_rank, r.user_id, u.display_name, r.final_net_worth
        from season_results r join users u on u.id = r.user_id
        where r.season_id = ${seasonId}
        order by r.final_rank`,
  )
  return found.map((r) => ({
    rank: Number(r.final_rank),
    userId: r.user_id,
    displayName: r.display_name,
    netWorth: BigInt(r.final_net_worth),
  }))
}

async function finishEndedSeason(
  running: SeasonRow | null,
  config: ConfigValues,
  now: Date,
): Promise<Outgoing[]> {
  if (!isDue('end', now)) return []
  const [season] = await db()
    .select(seasonColumns)
    .from(seasons)
    .where(and(lte(seasons.endsAt, sql`now()`), ne(seasons.status, 'ended')))
    .orderBy(desc(seasons.endsAt), asc(seasons.id))
    .limit(1)
  if (!season) {
    // Nothing waits to be frozen until the running season ends.
    dueAt('end', running?.endsAt ?? null, now)
    return []
  }

  return db().transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: seasons.status })
      .from(seasons)
      .where(eq(seasons.id, season.id))
      .for('update')
    if (!locked || locked.status === 'ended') return []

    const [state] = await rows<{ open: number; timed_out: boolean }>(
      tx,
      sql`select count(r.id)::int as open,
            now() >= s.ends_at + make_interval(mins => ${config.round_timeout_minutes}) as timed_out
          from seasons s
          left join game_rounds r on r.season_id = s.id and r.status = 'open'
          where s.id = ${season.id}
          group by s.ends_at`,
    )
    // A round dealt before the end is played out first; it can wait no longer than the timeout.
    if (state && state.open > 0 && !state.timed_out) return []

    const places = await freezeStandings(tx, season.id)
    await tx.update(seasons).set({ status: 'ended' }).where(eq(seasons.id, season.id))
    const post = await announce(tx, {
      seasonId: season.id,
      key: 'ended',
      body: podiumText(season.name, places),
      meta: { tone: 'win', ...(places[0] ? { userId: places[0].userId } : {}) },
      post: now.getTime() - season.endsAt.getTime() < STALE_END_MS,
    })
    return [seasonStateEvent(season.id, 'over'), ...post]
  })
}
