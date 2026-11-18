/**
 * The compact leaderboard (spec: Right sidebar): rank, avatar, name, net
 * worth, and an arrow when someone moves. Rows slide when ranks swap.
 */
import { LayoutGroup, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from 'react-router'

import type { StandingView } from '../../../shared/seasons.ts'
import { AnimatedNumber } from '../../kit/AnimatedNumber.tsx'
import { ArrowDownIcon, ArrowUpIcon } from '../../kit/icons.tsx'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useLeaderboard, useMe } from '../../kit/queries.ts'
import { type Move, rankMoves, soleLeader } from '../standings.ts'
import { useUi } from '../ui.ts'

const NOBODY: readonly StandingView[] = []

/** Who moved since the board was first drawn. */
function useMoves(standings: readonly StandingView[]): ReadonlyMap<string, Move> {
  const [seen, setSeen] = useState({
    rows: standings,
    moves: new Map<string, Move>(),
    change: 0,
  })
  if (seen.rows !== standings) {
    const change = seen.change + 1
    setSeen({ rows: standings, moves: rankMoves(seen.rows, standings, seen.moves, change), change })
  }
  return seen.moves
}

export function Leaderboard({ limit }: { limit?: number }) {
  const me = useMe()
  const { data, isPending, isError, refetch } = useLeaderboard()
  const standings = data?.standings ?? NOBODY
  const moves = useMoves(standings)
  const showProfile = useUi((s) => s.showProfile)

  if (isPending) {
    return (
      <ol className="space-y-1.5 px-3" aria-label="Loading the leaderboard">
        {Array.from({ length: limit ?? 5 }, (_, i) => (
          <li key={i} className="skeleton h-9" />
        ))}
      </ol>
    )
  }
  if (isError) {
    return (
      <p className="px-4 text-sm text-muted">
        The leaderboard did not load.{' '}
        <button type="button" className="text-accent underline" onClick={() => void refetch()}>
          Try again
        </button>
      </p>
    )
  }
  if (!standings.length) {
    return <p className="px-4 text-sm text-muted">The board fills up once the season starts.</p>
  }

  let rows = standings
  if (limit && standings.length > limit) {
    rows = standings.slice(0, limit)
    const mine = standings.find((s) => s.userId === me.id)
    if (mine && mine.rank > limit) rows = [...standings.slice(0, limit - 1), mine]
  }

  const leader = soleLeader(standings)
  return (
    <LayoutGroup>
      <ol className="space-y-0.5 px-2">
        {rows.map((row) => {
          const move = moves.get(row.userId)
          const first = row.userId === leader
          const mine = row.userId === me.id
          return (
            <motion.li
              key={row.userId}
              layout="position"
              transition={{ type: 'spring', stiffness: 500, damping: 42 }}
            >
              <button
                type="button"
                onClick={() => showProfile(row.userId)}
                className={`flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-surface-3 ${mine ? 'bg-surface-2' : ''}`}
              >
                <span
                  className={`w-5 shrink-0 text-right text-xs font-bold tabular-nums ${first ? 'text-gold' : 'text-faint'}`}
                >
                  {row.rank}
                </span>
                <Avatar player={row} size="sm" ring={first ? 'playing' : undefined} />
                <span className="min-w-0 flex-1">
                  <PlayerName player={row} />
                </span>
                <span className="flex items-center gap-1">
                  {move && (
                    <span
                      key={move.change}
                      className={`fade-late ${move.direction === 'up' ? 'text-online' : 'text-loss'}`}
                      aria-label={move.direction === 'up' ? 'Moved up' : 'Moved down'}
                    >
                      {move.direction === 'up' ? (
                        <ArrowUpIcon className="size-3" />
                      ) : (
                        <ArrowDownIcon className="size-3" />
                      )}
                    </span>
                  )}
                  <AnimatedNumber
                    value={row.netWorth}
                    className={`text-sm font-semibold ${first ? 'text-gold' : 'text-text'}`}
                  />
                </span>
              </button>
            </motion.li>
          )
        })}
      </ol>
      {limit && standings.length > rows.length && (
        <Link to="/leaderboard" className="mx-4 mt-1 block text-xs text-muted hover:text-text">
          See all {standings.length} players
        </Link>
      )}
    </LayoutGroup>
  )
}
