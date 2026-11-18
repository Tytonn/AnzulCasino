/**
 * The ticker (spec: Site layout > Ticker): a thin strip of results from every
 * room, newest first. Each one opens that round.
 */
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router'

import { formatChips } from '../../../shared/chips.ts'
import type { RoundSummary } from '../../../shared/events.ts'
import { PlayerName } from '../../kit/PlayerName.tsx'
import { usePlayer, useTicker } from '../../kit/queries.ts'
import { gameById } from '../registry.ts'

export function Ticker() {
  const { data: rounds, isPending } = useTicker()
  return (
    <div
      className="relative h-8 shrink-0 overflow-hidden border-b border-border bg-surface-1"
      aria-label="Latest results"
    >
      <div className="absolute inset-y-0 left-0 flex items-center gap-1 pl-3 text-[0.65rem] font-bold tracking-[0.14em] text-faint uppercase">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-online opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-online" />
        </span>
        <span className="hidden sm:inline">Live</span>
      </div>
      <ol className="absolute inset-y-0 right-0 left-9 flex items-center gap-5 overflow-hidden pr-6 sm:left-16 [mask-image:linear-gradient(to_right,black_85%,transparent)]">
        {isPending && <li className="skeleton h-3 w-64" />}
        {rounds?.length === 0 && (
          <li className="truncate text-xs text-faint">
            No rounds yet this season. Results from every room show up here.
          </li>
        )}
        <AnimatePresence initial={false}>
          {rounds?.map((round) => (
            <motion.li
              key={round.roundId}
              layout="position"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              className="shrink-0"
            >
              <TickerItem round={round} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}

function TickerItem({ round }: { round: RoundSummary }) {
  const player = usePlayer(round.userId)
  const game = gameById(round.game)
  const Icon = game?.icon
  const won = round.net > 0
  const lost = round.net < 0
  return (
    <Link
      to={`/history/${round.roundId}`}
      className={`flex items-center gap-1.5 rounded-sm px-1 text-xs whitespace-nowrap hover:bg-surface-3 ${round.bigBet ? 'font-semibold' : ''}`}
      title={`${game?.name ?? round.game}: ${round.summary}`}
    >
      {Icon && <Icon className="size-3.5 text-faint" />}
      <PlayerName player={player} badge={false} className="max-w-28" />
      <span className={won ? 'text-gold' : lost ? 'text-loss' : 'text-muted'}>
        {won
          ? `won ${formatChips(round.net)}`
          : lost
            ? `lost ${formatChips(-round.net)}`
            : 'broke even'}
      </span>
      {round.multiplier !== null && round.multiplier !== 0 && won && (
        <span className="text-faint">{(round.multiplier / 100).toFixed(2)}x</span>
      )}
      {round.summary && <span className="text-faint">· {round.summary}</span>}
    </Link>
  )
}
