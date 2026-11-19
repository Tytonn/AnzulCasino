/**
 * The ticker (spec: Site layout > Ticker): a thin strip of results from every
 * room, and every steal attempt (Steal rules, rule 7), newest first. A round
 * opens that round. A steal opens the thief's profile card, where the Rob
 * button is.
 */
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { formatChips, formatMultiplier } from '../../../shared/chips.ts'
import type { RoundSummary } from '../../../shared/events.ts'
import type { StealView } from '../../../shared/steals.ts'
import { tickerKey } from '../../../shared/ticker.ts'
import { MaskIcon, ShieldIcon } from '../../kit/icons.tsx'
import { PlayerName } from '../../kit/PlayerName.tsx'
import { usePlayer, useTicker } from '../../kit/queries.ts'
import { gameById } from '../registry.ts'
import { useUi } from '../ui.ts'

const ITEM =
  'flex items-center gap-1.5 rounded-sm px-1 text-xs whitespace-nowrap hover:bg-surface-3'

export function Ticker() {
  const { data: items, isPending } = useTicker()
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
        {items?.length === 0 && (
          <li className="truncate text-xs text-faint">
            No rounds yet this season. Results from every room and every steal show up here.
          </li>
        )}
        <AnimatePresence initial={false}>
          {items?.map((item) => (
            <motion.li
              key={tickerKey(item)}
              layout="position"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              className="shrink-0"
            >
              {item.kind === 'round' ? (
                <RoundItem round={item.round} />
              ) : (
                <StealItem steal={item.steal} />
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  )
}

function RoundItem({ round }: { round: RoundSummary }) {
  const player = usePlayer(round.userId)
  const game = gameById(round.game)
  const Icon = game?.icon
  const won = round.net > 0
  const lost = round.net < 0
  return (
    <Link
      to={`/history/${round.roundId}`}
      className={`${ITEM} ${round.bigBet ? 'font-semibold' : ''}`}
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
        <span className="text-faint">{formatMultiplier(round.multiplier)}</span>
      )}
      {round.summary && <span className="text-faint">· {round.summary}</span>}
    </Link>
  )
}

function StealItem({ steal }: { steal: StealView }) {
  const thief = usePlayer(steal.thiefId)
  const target = usePlayer(steal.targetId)
  const showProfile = useUi((s) => s.showProfile)
  const thiefName = <PlayerName player={thief} badge={false} className="max-w-28" />
  const targetName = <PlayerName player={target} badge={false} className="max-w-28" />
  const who = thief?.displayName ?? 'Someone'
  const whom = target?.displayName ?? 'someone'
  let title: string
  let line: ReactNode
  if (steal.outcome === 'success') {
    title = `${who} robbed ${whom} for ${formatChips(steal.amount)}.`
    line = (
      <>
        {thiefName}
        <span className="text-gold">robbed</span>
        {targetName}
        <span className="text-gold">{formatChips(steal.amount)}</span>
      </>
    )
  } else if (steal.outcome === 'blocked') {
    title = `${whom}'s shield blocked a steal by ${who}.`
    line = (
      <>
        <span className="flex min-w-0 items-center">
          {targetName}
          <span className="text-muted">’s</span>
        </span>
        <span className="text-muted">shield blocked</span>
        {thiefName}
      </>
    )
  } else {
    title =
      steal.fine > 0
        ? `${who} got caught robbing ${whom} and paid a ${formatChips(steal.fine)} fine.`
        : `${who} got caught robbing ${whom}.`
    line = (
      <>
        {thiefName}
        <span className="text-loss">got caught robbing</span>
        {targetName}
        {steal.fine > 0 && <span className="text-faint">· fined {formatChips(steal.fine)}</span>}
      </>
    )
  }
  const Icon = steal.outcome === 'blocked' ? ShieldIcon : MaskIcon
  return (
    <button
      type="button"
      onClick={() => showProfile(steal.thiefId)}
      className={ITEM}
      title={`${title} Open ${who}'s profile.`}
    >
      <Icon className="size-3.5 text-faint" />
      {line}
    </button>
  )
}
