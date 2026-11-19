/**
 * Keeping the leaderboard current from `standing.changed` events, and the
 * arrows that show who just moved (spec: Right sidebar: "an arrow when
 * someone moves"; rows slide when ranks swap).
 */
import type { StandingChanged } from '../../shared/events.ts'
import type { LeaderboardView, StandingView } from '../../shared/seasons.ts'
import { isNewer } from '../live/versions.ts'

/**
 * The leaderboard after one player's chips changed. Returns `refetch` when
 * the event names someone the board does not have yet (a late joiner), and
 * the same object when the event is stale or for another season.
 */
export function applyStanding(
  view: LeaderboardView,
  change: StandingChanged,
  version: number,
): LeaderboardView | 'refetch' {
  if (view.seasonId !== change.seasonId) return view.seasonId === null ? 'refetch' : view
  const row = view.standings.find((s) => s.userId === change.userId)
  if (!row) return 'refetch'
  if (!isNewer(version, row.version)) return view
  const updated: StandingView = {
    ...row,
    balance: change.balance,
    vault: change.vault,
    netWorth: change.netWorth,
    tier: change.tier,
    version,
  }
  return { ...view, standings: rerank(view.standings.map((s) => (s === row ? updated : s))) }
}

/**
 * Highest net worth first. Players the server ranked level (same net worth,
 * reached at the same moment, such as everyone at the season start) stay
 * level while their net worth matches. Anyone else is ranked by place, with
 * a stable sort keeping ties in their old order: whoever got there first
 * stays ahead, as on the server. The next fetch settles any doubt.
 */
export function rerank(standings: readonly StandingView[]): StandingView[] {
  const sorted = [...standings].sort((a, b) => b.netWorth - a.netWorth)
  const ranked: StandingView[] = []
  sorted.forEach((row, i) => {
    const before = sorted[i - 1]
    const placed = ranked[i - 1]
    const level = before && placed && before.netWorth === row.netWorth && before.rank === row.rank
    const rank = level ? placed.rank : i + 1
    ranked.push(row.rank === rank ? row : { ...row, rank })
  })
  return ranked
}

/**
 * The player shown in gold: the leader, when they lead alone. Nobody while
 * players are level at the top, such as everyone at the season start.
 */
export function soleLeader(standings: readonly StandingView[]): string | null {
  const top = standings.filter((s) => s.rank === 1)
  return top.length === 1 && top[0] ? top[0].userId : null
}

/** `change` counts board changes, so a new move restarts its arrow's fade. */
export type Move = { direction: 'up' | 'down'; change: number }

/** Who moved between two boards. A player keeps their arrow until they move again. */
export function rankMoves(
  before: readonly StandingView[],
  after: readonly StandingView[],
  known: ReadonlyMap<string, Move>,
  change: number,
): Map<string, Move> {
  const moves = new Map(known)
  const old = new Map(before.map((s) => [s.userId, s.rank]))
  for (const row of after) {
    const was = old.get(row.userId)
    if (was === undefined || was === row.rank) continue
    moves.set(row.userId, { direction: row.rank < was ? 'up' : 'down', change })
  }
  return moves
}
