/**
 * Another player's hand on their seat (spec: Blackjack > Other seats: "each
 * card as it lands, the hand total and the result"). Small cards, the
 * dealer's row over theirs, and a total for each hand. The result itself is
 * on the seat's own line under it.
 */
import { motion, useReducedMotion } from 'motion/react'

import {
  type BlackjackDetail,
  type Card,
  handTotal,
  isBust,
  isRed,
  rankLabel,
  suitOf,
  totalLabel,
} from '../../../shared/games/blackjack.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { SuitIcon } from './Card.tsx'

function MiniCard({ card, delay }: { card: Card | null; delay: number }) {
  const reduced = useReducedMotion()
  return (
    <motion.span
      className="-ml-1.5 flex h-7 w-5 flex-col items-center justify-center rounded-[4px] border first:ml-0"
      style={
        card
          ? {
              background: 'var(--bj-paper)',
              borderColor: 'var(--bj-paper-edge)',
              color: isRed(card) ? 'var(--bj-ink-red)' : 'var(--bj-ink)',
            }
          : {
              background: 'radial-gradient(circle at 50% 40%, var(--bj-back), var(--bj-back-deep))',
              borderColor: 'var(--bj-paper)',
            }
      }
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 28, delay }}
    >
      {card && (
        <>
          <span className="text-[0.6rem] leading-none font-extrabold tracking-tighter">
            {rankLabel(card)}
          </span>
          <SuitIcon suit={suitOf(card)} className="mt-px w-2" />
        </>
      )}
    </motion.span>
  )
}

function Row({
  label,
  cards,
  hole,
  delayFrom,
  active,
}: {
  label: string
  cards: Card[]
  hole: boolean
  /** Cards from this index on land one after another: the dealer drawing. */
  delayFrom: number
  active: boolean
}) {
  const bust = isBust(cards)
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className={`w-7 shrink-0 text-[0.6rem] font-semibold tracking-wide uppercase ${active ? 'text-accent-strong' : 'text-faint'}`}
      >
        {label}
      </span>
      <span className="flex min-w-0 items-center">
        {cards.map((card, i) => (
          <MiniCard key={i} card={card} delay={i >= delayFrom ? (i - delayFrom + 1) * 0.14 : 0} />
        ))}
        {hole && <MiniCard key="hole" card={null} delay={0} />}
      </span>
      {cards.length > 0 && (
        <span
          className={`ml-auto shrink-0 text-xs font-bold tabular-nums ${bust ? 'text-loss' : handTotal(cards).total === 21 ? 'text-gold' : 'text-muted'}`}
        >
          {bust ? `Bust` : totalLabel(cards)}
        </span>
      )}
    </div>
  )
}

export function MiniTable({ round }: { round: RoundView<BlackjackDetail> | null }) {
  if (!round) return null
  const { detail } = round
  if (!Array.isArray(detail.hands) || detail.hands.length === 0) {
    return <p className="py-2 text-xs text-muted">Dealing…</p>
  }
  const open = round.status === 'open'
  const split = detail.hands.length > 1
  return (
    <div
      className="flex w-full flex-col gap-1 py-0.5"
      aria-label={`Dealer ${totalLabel(detail.dealer)}, ${detail.hands.map((h) => totalLabel(h.cards)).join(' and ')}`}
    >
      <Row label="Dlr" cards={detail.dealer} hole={open} delayFrom={open ? 99 : 1} active={false} />
      {detail.hands.map((hand, i) => (
        <Row
          key={i}
          label={split ? `H${i + 1}` : 'Hand'}
          cards={hand.cards}
          hole={false}
          delayFrom={99}
          active={open && split && detail.active === i}
        />
      ))}
    </div>
  )
}
