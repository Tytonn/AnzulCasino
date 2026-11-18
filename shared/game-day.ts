/**
 * The game day (spec: Accounts and seasons > The game day). Daily limits reset
 * at 4:00 AM Central, so a late-night session is not split in two. Everything
 * daily uses these helpers: the bonus, challenges, steal attempts, loss caps,
 * the vault move, rank purchases.
 *
 * Pass database time (`ctx.now` on the server, rule 8). In the browser, pass
 * the clock corrected by the offset from /api/time, for display only.
 *
 * Central time moves with daylight saving, so the reset is 4:00 on the wall
 * clock in America/Chicago: 09:00 or 10:00 UTC depending on the season.
 */

/** Time zone and wall-clock hour of the daily reset. Fixed by the spec, not config. */
export const GAME_DAY_TIME_ZONE = 'America/Chicago'
export const GAME_DAY_RESET_HOUR = 4

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

const wallClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: GAME_DAY_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/**
 * The wall-clock time in Central at `at`, written as if it were UTC. Plain
 * arithmetic on it is wall-clock arithmetic, which daylight saving cannot skew.
 */
function centralWallClock(at: Date): number {
  const parts: Record<string, number> = {}
  for (const part of wallClockFormat.formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value)
  }
  const { year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0 } = parts
  return Date.UTC(year, month - 1, day, hour, minute, second, at.getUTCMilliseconds())
}

function isoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10)
}

/** The game day `now` falls in, as YYYY-MM-DD. 03:59 Central still counts as the day before. */
export function gameDay(now: Date): string {
  return isoDate(centralWallClock(now) - GAME_DAY_RESET_HOUR * HOUR_MS)
}

/** Adds whole days to a YYYY-MM-DD game day. */
export function addGameDays(day: string, days: number): string {
  return isoDate(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
}

/** The moment game day `day` (YYYY-MM-DD) begins: 4:00 AM Central on that date. */
export function gameDayStart(day: string): Date {
  const wanted = Date.parse(`${day}T00:00:00Z`) + GAME_DAY_RESET_HOUR * HOUR_MS
  // Guess that the wall clock is UTC, then correct by the zone's offset at the
  // guess. Two passes settle it; 4:00 is never inside a daylight saving jump.
  let guess = wanted
  for (let pass = 0; pass < 2; pass++) guess += wanted - centralWallClock(new Date(guess))
  return new Date(guess)
}

/** The next daily reset after `now`. */
export function nextReset(now: Date): Date {
  return gameDayStart(addGameDays(gameDay(now), 1))
}

/**
 * Which day of the season `now` is: 1 on the game day the season starts, 2 on
 * the next, and so on. 0 or less before the season starts.
 */
export function seasonDay(seasonStartsAt: Date, now: Date): number {
  const first = Date.parse(`${gameDay(seasonStartsAt)}T00:00:00Z`)
  const today = Date.parse(`${gameDay(now)}T00:00:00Z`)
  return Math.round((today - first) / DAY_MS) + 1
}
