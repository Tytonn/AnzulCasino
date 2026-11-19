/**
 * Lazy moments without timers (CLAUDE.md: Keep the database asleep). The
 * final day, the end of a season, rank unlocks and chat drops all happen "on
 * the first request after the moment". Checking that costs a query, so each
 * instance remembers when the next moment of each kind is due and skips the
 * query until then. The database still decides, with now(), inside the
 * transaction that acts; this only saves asking too early.
 *
 * A remembered time is trusted for at most ten minutes, so a config change
 * or another instance's work is never missed for long.
 */
const TRUST_MS = 10 * 60_000

const next = new Map<string, number>()

/** True when the moment called `key` may have come, so it is worth a query. */
export function isDue(key: string, now: Date): boolean {
  const at = next.get(key)
  return at === undefined || now.getTime() >= at
}

/** Remembers that nothing called `key` happens before `at` (null: not this season). */
export function dueAt(key: string, at: Date | null, now: Date): void {
  const limit = now.getTime() + TRUST_MS
  next.set(key, at === null ? limit : Math.min(at.getTime(), limit))
}

/** Forgets every remembered moment. Tests call it after moving a season's clock. */
export function forgetMoments(): void {
  next.clear()
}
