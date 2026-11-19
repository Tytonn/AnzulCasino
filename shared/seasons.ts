/**
 * Seasons (spec: Accounts and seasons > Seasons), shared by the browser and
 * the server.
 *
 * The stored `status` records what has been done to a season: `scheduled`
 * until its starting balances are given out, `active` after. The economy lane
 * moves it on to `final_day` and `ended` when it builds the final day and the
 * podium. Where a season is in its life right now is its phase, which comes
 * from the clock alone, so it is exact even when nobody has made a request.
 */
import { z } from 'zod'

export const SEASON_STATUSES = ['scheduled', 'active', 'final_day', 'ended'] as const
export type SeasonStatus = (typeof SEASON_STATUSES)[number]

/**
 * - `upcoming`: before the start time.
 * - `open`: between the start and the final day.
 * - `final_day`: the last `final_freeze_hours` before the end. Games stay
 *   open; steals, shields, vault moves and rank purchases stop.
 * - `over`: at or after the end time. No new bets.
 */
export const SEASON_PHASES = ['upcoming', 'open', 'final_day', 'over'] as const
export type SeasonPhase = (typeof SEASON_PHASES)[number]

const HOUR_MS = 3_600_000

/** The phase at `now` (database time on the server). */
export function seasonPhase(
  season: { startsAt: Date; endsAt: Date },
  now: Date,
  finalFreezeHours: number,
): SeasonPhase {
  const t = now.getTime()
  if (t < season.startsAt.getTime()) return 'upcoming'
  if (t >= season.endsAt.getTime()) return 'over'
  if (t >= season.endsAt.getTime() - finalFreezeHours * HOUR_MS) return 'final_day'
  return 'open'
}

/** True while games take new bets: from the start time until the end time. */
export function takesBets(phase: SeasonPhase): boolean {
  return phase === 'open' || phase === 'final_day'
}

/** A season as the API sends it. Chip amounts are hundredths. */
export interface SeasonView {
  id: number
  name: string
  startsAt: string
  endsAt: string
  startingBalance: number
  status: SeasonStatus
  phase: SeasonPhase
}

/** GET /api/season */
export interface SeasonState {
  /** The season running now, or else the last one that ran. */
  current: SeasonView | null
  /** The next season that has not started yet. */
  next: SeasonView | null
  /**
   * The caller's chips in the current season. `version` is the wallet's
   * latest ledger id: `wallet.updated` events not newer than it are stale.
   */
  wallet: { balance: number; vault: number; tier: string; version: number } | null
}

const When = (message: string) =>
  z.iso.datetime({ offset: true, error: message }).transform((value) => new Date(value))

/** POST /api/seasons (admin). Times are ISO strings with an offset. */
export const CreateSeasonInput = z
  .strictObject({
    name: z
      .string()
      .trim()
      .min(1, 'Name the season.')
      .max(40, 'Season names are up to 40 characters.'),
    startsAt: When('Pick a start time.'),
    endsAt: When('Pick an end time.'),
    /** Hundredths. Defaults to the starting_balance setting. */
    startingBalance: z
      .number()
      .int('The starting balance must be a whole number of hundredths.')
      .positive('The starting balance must be above zero.')
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .refine((s) => s.endsAt > s.startsAt, 'The season must end after it starts.')
export type CreateSeasonInput = z.infer<typeof CreateSeasonInput>

/** A row of GET /api/leaderboard. Chip amounts are hundredths. */
export interface StandingView {
  /** 1 is first. Players level on net worth and on when they reached it share a rank. */
  rank: number
  userId: string
  username: string
  displayName: string
  avatar: string
  avatarColor: string
  tier: string
  balance: number
  vault: number
  netWorth: number
  /** The wallet's latest ledger id: `standing.changed` events not newer than it are stale. */
  version: number
}

/** GET /api/leaderboard */
export interface LeaderboardView {
  seasonId: number | null
  standings: StandingView[]
}
