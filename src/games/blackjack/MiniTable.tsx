/**
 * Another player's hand on their seat (spec: Blackjack > Other seats: "each
 * card as it lands, the hand total and the result"). One row: their cards
 * and total (both hands after a split) and what the dealer shows. The
 * result itself is on the seat's own line under it.
 *
 * The row is there dealt or not, so every seat keeps one height and your own
 * table never shrinks because a friend started a hand.
 */
import { motion, useReducedMotion } from 'motion/react'

import {
  type BlackjackDetail,
  type Card,
  cardValue,
  handTotal,
  isBust,
  isRed,
  rankLabel,
  suitOf,
  totalLabel,
} from '../../../shared/games/blackjack.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { SuitIcon } from './Card.tsx'

function MiniCard({ card, tight }: { card: Card; tight: boolean }) {
  const reduced = useReducedMotion()
  return (
    <motion.span
      className={`flex h-7 w-5 shrink-0 flex-col items-start rounded-[4px] border pt-0.5 pl-[2px] first:ml-0 ${tight ? '-ml-2' : '-ml-1.5'}`}
      style={{
        background: 'var(--bj-paper)',
        borderColor: 'var(--bj-paper-edge)',
        color: isRed(card) ? 'var(--bj-ink-red)' : 'var(--bj-ink)',
      }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 28 }}
    >
      <span className="text-[0.6rem] leading-none font-extrabold tracking-tighter">
        {rankLabel(card)}
      </span>
      <SuitIcon suit={suitOf(card)} className="mt-px w-2" />
    </motion.span>
  )
}

/** A hand: its cards and its total, the best one once it stands. */
function Hand({
  cards,
  final,
  tight = false,
  dim = false,
}: {
  cards: Card[]
  final: boolean
  tight?: boolean
  dim?: boolean
}) {
  const bust = isBust(cards)
  const { total } = handTotal(cards)
  return (
    <span
      className={`flex min-w-0 items-center gap-1 transition-opacity ${dim ? 'opacity-50' : ''}`}
    >
      <span className="flex min-w-0 items-center">
        {cards.map((card, i) => (
          <MiniCard key={i} card={card} tight={tight} />
        ))}
      </span>
      <span
        className={`shrink-0 text-xs font-bold tabular-nums ${bust ? 'text-loss' : total === 21 ? 'text-gold' : 'text-text'}`}
      >
        {bust ? 'Bust' : final ? total : totalLabel(cards)}
      </span>
    </span>
  )
}

/** What the dealer shows: the up card while the hand plays, then the dealer's total. */
function dealerShows(detail: BlackjackDetail, open: boolean): string {
  const [up] = detail.dealer
  if (!up) return '–'
  if (open) return cardValue(up) === 1 ? 'A' : String(cardValue(up))
  return isBust(detail.dealer) ? 'bust' : String(handTotal(detail.dealer).total)
}

export function MiniTable({ round }: { round: RoundView<BlackjackDetail> | null }) {
  const detail = round?.detail
  const dealt = detail !== undefined && Array.isArray(detail.hands) && detail.hands.length > 0
  if (!round || !dealt) {
    return (
      <div aria-hidden="true" className="flex h-7 w-full items-center">
        <span className="h-7 w-5 rounded-[4px] border border-dashed border-border-strong opacity-60" />
        <span className="-ml-2 h-7 w-5 rounded-[4px] border border-dashed border-border-strong opacity-60" />
      </div>
    )
  }
  const open = round.status === 'open'
  const split = detail.hands.length > 1
  const dealer = dealerShows(detail, open)
  return (
    <div
      role="img"
      className="flex h-7 w-full min-w-0 items-center gap-2"
      aria-label={`${detail.hands.map((h) => totalLabel(h.cards)).join(' and ')} against the dealer's ${dealer}`}
    >
      {detail.hands.map((hand, i) => (
        <Hand
          key={i}
          cards={hand.cards}
          final={!open || hand.done}
          tight={split}
          dim={open && split && detail.active !== i}
        />
      ))}
      <span className="ml-auto shrink-0 text-[0.65rem] whitespace-nowrap text-faint">
        vs <span className="font-bold text-muted tabular-nums">{dealer}</span>
      </span>
    </div>
  )
}
