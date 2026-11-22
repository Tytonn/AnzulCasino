/**
 * A player's seat at the table (spec: The room model > Seats): avatar, name,
 * current bet and the game's live state for them. A big bet or an all-in
 * glows with a tag until the result shows. The game draws its own state for
 * the player inside:
 *
 *   <Seat seat={seat}><MiniCoin round={seat.round} /></Seat>
 *   <EmptySeat />
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type ReactNode, useContext } from 'react'

import { formatChips, formatMultiplier } from '../../shared/chips.ts'
import type { RoundView } from '../../shared/rounds.ts'
import { ChipStack } from './ChipStack.tsx'
import { Avatar, PlayerName } from './PlayerName.tsx'
import type { RoomSeat } from './room.ts'
import { SeatExtras } from './seat-extras.ts'

export type SeatOutcome =
  | { kind: 'none' }
  | { kind: 'open'; stake: number }
  | { kind: 'win'; stake: number; net: number; multiplier: number | null }
  | { kind: 'loss'; stake: number; lost: number }
  | { kind: 'push'; stake: number }
  | { kind: 'void'; stake: number }

/** Where a seat's latest round stands, for its bet line. Amounts in chips. */
export function seatOutcome(round: RoundView<unknown> | null): SeatOutcome {
  if (!round) return { kind: 'none' }
  const { stake } = round
  if (round.status === 'open') return { kind: 'open', stake }
  if (round.status === 'void') return { kind: 'void', stake }
  const payout = round.payout ?? 0
  if (payout > stake) {
    return { kind: 'win', stake, net: payout - stake, multiplier: round.multiplier }
  }
  if (payout < stake) return { kind: 'loss', stake, lost: stake - payout }
  return { kind: 'push', stake }
}

/** The tag a seat wears while its round is open: "All in", "Big bet", or none. */
export function seatTag(round: RoundView<unknown> | null): string | null {
  if (round?.status !== 'open') return null
  if (round.allIn) return 'All in'
  return round.bigBet ? 'Big bet' : null
}

const STATUS_TEXT = { playing: 'In a hand', active: 'Here', away: 'Away' } as const

function Result({ outcome }: { outcome: SeatOutcome }) {
  const reduced = useReducedMotion()
  let text: string
  let tone: string
  let note: string | null = null
  switch (outcome.kind) {
    case 'none':
    case 'open':
      return null
    case 'win':
      text = `+${formatChips(outcome.net)}`
      tone = 'text-gold'
      note = outcome.multiplier !== null ? formatMultiplier(outcome.multiplier) : null
      break
    case 'loss':
      text = `−${formatChips(outcome.lost)}`
      tone = 'text-loss'
      break
    case 'push':
      text = 'Push'
      tone = 'text-muted'
      break
    case 'void':
      text = 'Refunded'
      tone = 'text-muted'
      break
  }
  return (
    <motion.span
      className={`flex items-baseline gap-1 font-bold tabular-nums ${tone}`}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
    >
      {text}
      {note && <span className="text-[0.7em] font-semibold opacity-70">{note}</span>}
    </motion.span>
  )
}

export function Seat<D>({
  seat,
  size = 'sm',
  children,
  className = '',
}: {
  seat: RoomSeat<D>
  /** `lg` for your own seat, the table in the middle of the room. */
  size?: 'sm' | 'lg'
  /** The game's view of this player's round: their coin, cards or grid. */
  children?: ReactNode
  className?: string
}) {
  const extras = useContext(SeatExtras)
  const reduced = useReducedMotion()
  const { round, player } = seat
  const outcome = seatOutcome(round)
  const tag = seatTag(round)
  const large = size === 'lg'
  const name = seat.me ? 'Your' : `${player?.displayName ?? 'Someone'}'s`
  const status = seat.me ? 'You' : seat.status ? STATUS_TEXT[seat.status] : 'Here'
  const ring = seat.status === 'playing' ? 'playing' : seat.status === 'away' ? 'away' : 'online'

  return (
    <article
      aria-label={`${name} seat`}
      className={`relative flex min-w-0 flex-col rounded-lg border bg-surface-1 transition-[border-color,box-shadow,opacity] duration-250 ${
        tag ? 'seat-glow border-gold/70' : 'border-border'
      } ${seat.status === 'away' && !seat.me ? 'opacity-60' : ''} ${
        large ? 'gap-3 p-3 md:p-4' : 'gap-2 p-2.5'
      } ${className}`}
    >
      <header className="flex min-w-0 items-center gap-2">
        <Avatar player={player} size={large ? 'md' : 'sm'} ring={ring} />
        <div className="min-w-0 flex-1 leading-tight">
          <PlayerName player={player} className={large ? 'text-base' : 'text-sm'} />
          <p className="truncate text-[0.7rem] text-faint">{status}</p>
        </div>
        <AnimatePresence>
          {tag && (
            <motion.span
              key={tag}
              className="shrink-0 rounded-full bg-gold px-2 py-0.5 text-[0.65rem] font-bold tracking-wide text-on-gold uppercase"
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 600, damping: 28 }}
            >
              {tag}
            </motion.span>
          )}
        </AnimatePresence>
      </header>

      {children !== undefined && (
        // One column no wider than the seat (`minmax(0, 1fr)`), so a table that
        // could be wider, like a long row of recent numbers, scrolls inside its
        // seat instead of widening the whole page on a phone.
        <div
          className={`relative grid min-h-0 grid-cols-1 place-items-center ${large ? 'flex-1' : ''}`}
        >
          {children}
        </div>
      )}

      <footer
        className={`flex min-h-6 items-center justify-between gap-2 ${large ? 'text-base' : 'text-sm'}`}
      >
        {outcome.kind === 'none' ? (
          <span className="text-xs text-faint">{seat.me ? 'Place a bet' : 'Watching'}</span>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 text-muted">
            <ChipStack amount={outcome.stake} size="sm" />
            <span className="truncate tabular-nums">
              {large && (outcome.kind === 'open' ? 'In play ' : 'Bet ')}
              {formatChips(outcome.stake)}
            </span>
          </span>
        )}
        <Result key={round ? `${round.id}:${round.status}` : 'none'} outcome={outcome} />
      </footer>

      {extras?.({ game: seat.game, userId: seat.userId, me: seat.me })}
    </article>
  )
}

/** A seat nobody sits in yet: alone, you still sit at a full table. */
export function EmptySeat({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex min-h-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border p-2.5 text-center text-faint ${className}`}
    >
      <span
        aria-hidden="true"
        className="grid size-7 place-items-center rounded-full border border-dashed border-border-strong text-sm"
      >
        +
      </span>
      <span className="text-xs font-medium">Empty seat</span>
    </div>
  )
}

/** A seat-shaped placeholder while the room loads. */
export function SeatSkeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton min-h-24 rounded-lg ${className}`} />
}
