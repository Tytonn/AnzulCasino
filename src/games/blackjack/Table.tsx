/**
 * The felt: the dealer's cards at the top, yours at the bottom, and between
 * them what just happened. It draws whatever a frame of the round shows
 * (timeline.ts), so the room animates a hand by stepping the frame, and the
 * History replay draws the finished hand with the same component.
 *
 * Every card is placed by hand, from the middle of the table, so a split
 * slides the second card over to its own hand, and a new card deals in from
 * the shoe at the top right.
 */
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'motion/react'
import { type CSSProperties, type ReactNode, useEffect } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import {
  type BlackjackDetail,
  type BlackjackHand,
  type Card,
  dealerPeeks,
  handTotal,
  isBust,
  isNatural,
  RESULT_NAMES,
  totalLabel,
} from '../../../shared/games/blackjack.ts'
import { ChipStack } from '../../kit/index.ts'
import { TABLET, useMediaQuery, WIDE } from '../../kit/media.ts'
import { PlayingCard } from './Card.tsx'
import {
  type Frame,
  type Pace,
  shownDealer,
  shownHands,
  type SlowPace,
  type Step,
  type TableRound,
} from './timeline.ts'
import type { SlowPhase } from './useTimeline.ts'

export interface TableEffect {
  kind: 'flash' | 'thud'
  hand: number
  id: number
}

export type TableRoundView = TableRound & { stake: number; payout: number | null }

export interface TableProps {
  round: TableRoundView | null
  frame: Frame
  step?: Step | null
  slow?: SlowPhase | null
  pace: Pace
  slowPace: SlowPace
  /** The stake on its way while the deal request is out: chips before cards. */
  pending?: number | null
  effect?: TableEffect | null
  /** Taps on the felt: they turn a slow card over. */
  onTap?: () => void
  /** A finished hand in History: smaller, with no shoe and no lettering. */
  still?: boolean
}

/** The table's card width in pixels, by screen size. */
export function useCardWidth(still = false): number {
  const small = useMediaQuery('(min-width: 40rem)')
  const tablet = useMediaQuery(TABLET)
  const wide = useMediaQuery(WIDE)
  if (still) return tablet ? 52 : 40
  return wide ? 86 : tablet ? 72 : small ? 56 : 46
}

interface Placed {
  key: string
  card: Card | null
  down: boolean
  x: number
  rotate: number
  z: number
}

/** The step between two cards in a hand, as a share of the card's width. */
function spread(count: number): number {
  return count > 5 ? 0.3 : count > 4 ? 0.36 : 0.44
}

/** A hand's cards placed around its center. */
function place(
  cards: { key: string; card: Card | null; down?: boolean }[],
  center: number,
  width: number,
  doubled: boolean,
): Placed[] {
  const step = spread(cards.length) * width
  const span = width + step * (cards.length - 1)
  return cards.map((c, j) => {
    const sideways = doubled && j === 2
    return {
      key: c.key,
      card: c.card,
      down: c.down ?? false,
      x: center - span / 2 + j * step + (sideways ? width * 0.14 : 0),
      rotate: sideways ? 90 : 0,
      z: j,
    }
  })
}

function handSpan(count: number, width: number): number {
  return count === 0 ? 0 : width + spread(count) * width * (count - 1)
}

function CardRow({
  placed,
  roundId,
  width,
  from,
  slowKey,
  slow,
  slowPace,
  peekKey,
  peekMs,
}: {
  placed: Placed[]
  roundId: number
  width: number
  /** Where a new card comes from, relative to its place. */
  from: { x: number; y: number }
  slowKey: string | null
  slow: SlowPhase | null
  slowPace: SlowPace
  peekKey: string | null
  peekMs: number
}) {
  const reduced = useReducedMotion()
  return (
    <div className="relative w-full" style={{ height: width * 1.4 }}>
      <AnimatePresence initial={false}>
        {placed.map((c) => (
          <motion.div
            key={`${roundId}:${c.key}`}
            className="absolute top-0 left-1/2"
            style={{ zIndex: c.z }}
            initial={
              reduced
                ? { opacity: 0, x: c.x, y: 0, rotate: c.rotate }
                : { opacity: 0, x: c.x + from.x, y: from.y, rotate: 18, scale: 0.84 }
            }
            animate={{ opacity: 1, x: c.x, y: 0, rotate: c.rotate, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -width * 0.4, scale: 0.9 }}
            transition={{
              type: 'spring',
              stiffness: 380,
              damping: 32,
              mass: 0.8,
              opacity: { duration: 0.14 },
            }}
          >
            <PlayingCard
              card={c.card}
              faceUp={!c.down}
              slow={c.key === slowKey ? slow : null}
              liftMs={slowPace.lift}
              turnMs={slowPace.turn}
              peekMs={c.key === peekKey ? peekMs : 0}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

type Tone = 'plain' | 'gold' | 'loss' | 'muted'
const TONES: Record<Tone, string> = {
  plain: 'bg-surface-3 text-text',
  gold: 'bg-gold text-on-gold',
  loss: 'bg-loss text-on-accent',
  muted: 'bg-surface-2 text-muted',
}

function Pill({ children, tone = 'plain' }: { children: ReactNode; tone?: Tone }) {
  return (
    <motion.span
      layout="position"
      className={`inline-flex h-6 min-w-8 items-center justify-center rounded-full px-2 text-xs font-bold whitespace-nowrap tabular-nums shadow-card md:h-7 md:px-2.5 md:text-sm ${TONES[tone]}`}
    >
      {children}
    </motion.span>
  )
}

function signed(net: number): string {
  return net > 0 ? `+${formatChips(net)}` : net < 0 ? `−${formatChips(-net)}` : ''
}

/** The pill under a hand: its total while it plays, its result once settled. */
function HandPill({
  detail,
  hand,
  showing,
  done,
}: {
  detail: BlackjackDetail
  hand: BlackjackHand | undefined
  showing: Card[]
  done: boolean
}) {
  if (showing.length === 0) return null
  if (done && hand?.result) {
    const tone: Tone =
      hand.result === 'win' || hand.result === 'blackjack'
        ? 'gold'
        : hand.result === 'push'
          ? 'muted'
          : 'loss'
    const net = (hand.payout ?? 0) - hand.stake
    return (
      <Pill tone={tone}>
        {RESULT_NAMES[hand.result]}
        {net !== 0 && <span className="ml-1">{signed(net)}</span>}
      </Pill>
    )
  }
  const natural =
    hand !== undefined &&
    detail.hands.length === 1 &&
    showing.length === 2 &&
    isNatural(detail, hand)
  if (natural) return <Pill tone="gold">Blackjack</Pill>
  const { total } = handTotal(showing)
  if (total > 21) return <Pill tone="loss">Bust {total}</Pill>
  return <Pill tone={total === 21 ? 'gold' : 'plain'}>{totalLabel(showing)}</Pill>
}

/** One line in the middle of the felt: what is happening, or how the hand ended. */
function middleLine(round: TableRoundView | null, frame: Frame, step: Step | null): ReactNode {
  if (!round || round.detail.hands.length === 0) return null
  const { detail } = round
  const up = detail.dealer[0]
  if (step?.kind === 'hole' && up && dealerPeeks(up)) {
    return <span className="text-muted">Dealer checks for blackjack…</span>
  }
  if (!frame.done) {
    if (frame.split && detail.active !== null && round.status === 'open') {
      return <span className="text-muted">Hand {detail.active + 1} of 2</span>
    }
    return null
  }
  const net = (round.payout ?? 0) - round.stake
  const dealer = handTotal(detail.dealer).total
  const [first] = detail.hands
  let words = ''
  if (detail.hands.length > 1) {
    const results = detail.hands.map((h) => (h.result ? RESULT_NAMES[h.result].toLowerCase() : ''))
    words =
      results[0] === results[1] ? `Both hands: ${results[0]}.` : `Hands: ${results.join(' and ')}.`
  } else if (first) {
    const mine = handTotal(first.cards).total
    switch (first.result) {
      case 'blackjack':
        words = 'Blackjack!'
        break
      case 'win':
        words = dealer > 21 ? `Dealer busts on ${dealer}.` : `${mine} beats ${dealer}.`
        break
      case 'push':
        words = isNatural(detail, first) ? 'Both blackjack. Push.' : `Push on ${dealer}.`
        break
      case 'bust':
        words = `Bust on ${mine}.`
        break
      case 'lose':
        words =
          detail.dealer.length === 2 && dealer === 21 && detail.peeked
            ? 'Dealer blackjack.'
            : `Dealer's ${dealer} beats ${mine}.`
        break
      default:
        break
    }
  }
  return (
    <span className="font-semibold">
      {words}{' '}
      {net > 0 ? (
        <span className="text-gold">{signed(net)}</span>
      ) : net < 0 ? (
        <span className="text-loss">{signed(net)}</span>
      ) : (
        <span className="font-normal text-muted">Your bet comes back.</span>
      )}
    </span>
  )
}

/** The shoe the cards come from, at the table's top right. */
function Shoe() {
  return (
    <div aria-hidden="true" className="absolute top-2 right-3 hidden md:block">
      <div className="relative h-[calc(var(--bj-card-w)*0.8)] w-[calc(var(--bj-card-w)*1.15)]">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bj-card-back absolute top-0 left-0 h-[calc(var(--bj-card-w)*0.62)] w-[calc(var(--bj-card-w)*0.9)]"
            style={{ transform: `rotate(-14deg) translate(${i * 2.5}px, ${-i * 1.5}px)` }}
          />
        ))}
        <div className="absolute right-0 bottom-0 left-[8%] h-[46%] rounded-md border border-border-strong bg-surface-3 shadow-card" />
      </div>
    </div>
  )
}

/** The lettering on the felt. */
function Print() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 400 120"
      className="bj-print pointer-events-none absolute top-1/2 left-1/2 hidden w-[min(30rem,70%)] -translate-x-1/2 -translate-y-[44%] md:block"
    >
      <defs>
        <path id="bj-arc-1" d="M20 16 Q200 116 380 16" />
        <path id="bj-arc-2" d="M78 44 Q200 150 322 44" />
      </defs>
      <text fontSize="15" fontWeight="800" letterSpacing="4" textAnchor="middle">
        <textPath href="#bj-arc-1" startOffset="50%">
          BLACKJACK PAYS 3 TO 2
        </textPath>
      </text>
      <text fontSize="9.5" fontWeight="700" letterSpacing="2.6" textAnchor="middle">
        <textPath href="#bj-arc-2" startOffset="50%">
          DEALER STANDS ON ALL 17s
        </textPath>
      </text>
    </svg>
  )
}

export function Table({
  round,
  frame,
  step = null,
  slow = null,
  pace,
  slowPace,
  pending = null,
  effect = null,
  onTap,
  still = false,
}: TableProps) {
  const reduced = useReducedMotion()
  const width = useCardWidth(still)
  const wide = useMediaQuery(TABLET)
  const [yours, shake] = useAnimate<HTMLDivElement>()
  const detail = round?.detail ?? null
  const roundId = round?.id ?? 0
  const open = round?.status === 'open'

  // The player's hands, side by side once split.
  const hands = detail ? shownHands(detail, frame) : []
  const widest = Math.max(0, ...hands.map((h) => handSpan(h.length, width)))
  const apart = hands.length > 1 ? Math.max(widest / 2 + width * 0.35, width * 1.5) : 0
  const centers = hands.length > 1 ? [-apart, apart] : [0]
  const player = hands.flatMap((cards, i) => {
    const hand = detail?.hands[frame.split ? i : 0]
    const doubled = hand?.doubled === true && (frame.split || detail?.hands.length === 1)
    return place(cards, centers[i] ?? 0, width, doubled)
  })

  // The dealer: the up card, then the hole card face down or turned over, then draws.
  const dealerCards: { key: string; card: Card | null; down?: boolean }[] = detail
    ? shownDealer(detail, frame)
    : []
  if (frame.hole && detail) {
    dealerCards.push({ key: 'd1', card: open ? null : (detail.dealer[1] ?? null), down: true })
  }
  const dealer = place(dealerCards, 0, width, false)
  const dealerShowing = (detail ? shownDealer(detail, frame) : []).map((c) => c.card)
  const dealerBust = isBust(dealerShowing)

  // The card the slow reveal is turning, and the hole card the dealer checks.
  const slowKey =
    slow && step?.kind === 'player'
      ? (hands[step.hand]?.at(-1)?.key ?? null)
      : slow && step?.kind === 'flip'
        ? 'd1'
        : null
  const up = detail?.dealer[0]
  const peekKey = step?.kind === 'hole' && up && dealerPeeks(up) ? 'd1' : null

  // A bust on the slow reveal shakes your cards.
  const thud = effect?.kind === 'thud' ? effect.id : null
  useEffect(() => {
    if (thud === null || reduced || !yours.current) return
    void shake(yours.current, { x: [0, -10, 10, -7, 7, -3, 0] }, { duration: 0.45 })
  }, [thud, reduced, yours, shake])

  const fromPlayer = { x: wide ? width * 4.4 : width * 3, y: -width * (wide ? 3.6 : 3) }
  const fromDealer = { x: wide ? width * 4.2 : width * 2.8, y: -width * 0.6 }
  const line =
    pending !== null && !round ? (
      <span className="text-muted">Dealing…</span>
    ) : !round && !still ? (
      <span className="text-muted">Type a bet and deal.</span>
    ) : (
      middleLine(round, frame, step)
    )

  return (
    <div
      className={`bj-table relative flex size-full flex-col items-center justify-between select-none ${still ? 'gap-3 pt-1 pb-4' : 'gap-4 pt-1 pb-4 md:gap-6 md:pt-3 md:pb-6'}`}
      style={{ '--bj-card-w': `${width}px` } as CSSProperties}
      onClick={onTap}
    >
      {!still && <Print />}
      {!still && <Shoe />}

      <AnimatePresence>
        {effect && (
          <motion.div
            key={effect.id}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 z-30 rounded-lg ${effect.kind === 'flash' ? 'bj-flash' : 'bj-thud'}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            transition={{
              duration: reduced ? 0.35 : effect.kind === 'flash' ? 1.1 : 0.75,
              times: [0, 0.2, 1],
            }}
          />
        )}
      </AnimatePresence>

      {/* The dealer, with the total on a pill over the cards' bottom edge. */}
      <div className="relative w-full">
        <CardRow
          placed={dealer}
          roundId={roundId}
          width={width}
          from={fromDealer}
          slowKey={slowKey}
          slow={slow}
          slowPace={slowPace}
          peekKey={peekKey}
          peekMs={pace.peek}
        />
        <div className="absolute bottom-0 left-1/2 z-20 -translate-x-1/2 translate-y-1/2">
          <Pill tone={dealerBust ? 'loss' : 'muted'}>
            <span className="mr-1 text-[0.65em] font-semibold tracking-[0.14em] uppercase opacity-80">
              Dealer
            </span>
            {dealerShowing.length > 0 &&
              (dealerBust ? `Bust ${handTotal(dealerShowing).total}` : totalLabel(dealerShowing))}
          </Pill>
        </div>
      </div>

      {/* What just happened */}
      <div
        aria-live="polite"
        className="z-10 flex min-h-7 items-center justify-center px-2 text-center text-sm md:text-base"
      >
        <AnimatePresence mode="wait" initial={false}>
          {line && (
            <motion.span
              key={`${roundId}:${frame.done}:${peekKey !== null}:${frame.split ? (detail?.active ?? 'x') : 'one'}:${pending !== null}`}
              className="rounded-full bg-surface-1/70 px-3 py-1 shadow-card backdrop-blur-sm"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              {line}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* You */}
      <div className="relative w-full">
        {/* The hand being played, once there are two. */}
        <AnimatePresence>
          {open && frame.split && !frame.done && detail && detail.active !== null && (
            <motion.div
              key="active"
              aria-hidden="true"
              className="absolute top-[-6px] left-1/2 rounded-lg bg-surface-1/30 ring-1 ring-accent/70"
              style={{ height: width * 1.4 + 12 }}
              initial={{
                opacity: 0,
                x: (centers[detail.active] ?? 0) - widest / 2 - 8,
                width: widest + 16,
              }}
              animate={{
                opacity: 1,
                x: (centers[detail.active] ?? 0) - widest / 2 - 8,
                width: widest + 16,
              }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 34 }}
            />
          )}
        </AnimatePresence>
        <div ref={yours}>
          <CardRow
            placed={player}
            roundId={roundId}
            width={width}
            from={fromPlayer}
            slowKey={slowKey}
            slow={slow}
            slowPace={slowPace}
            peekKey={null}
            peekMs={0}
          />
        </div>

        {/* Each hand's total or result over its cards' bottom edge, and its stake beside it. */}
        {(hands.length > 0 ? hands : [[]]).map((cards, i) => {
          const hand = detail?.hands[frame.split ? i : 0]
          const showing = cards.map((c) => c.card)
          const stake = hand
            ? frame.split || detail?.hands.length === 1
              ? hand.stake
              : (detail?.bet ?? 0)
            : pending
          const waiting = open && frame.split && !frame.done && detail?.active !== i
          return (
            <motion.div
              key={`label${i}`}
              className="absolute bottom-0 left-1/2 z-20"
              initial={false}
              animate={{ x: centers[i] ?? 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              <div
                className={`flex -translate-x-1/2 translate-y-1/2 items-center gap-1.5 transition-opacity duration-250 ${waiting ? 'opacity-55' : ''}`}
              >
                {detail && (
                  <HandPill
                    detail={detail}
                    hand={frame.split || detail.hands.length === 1 ? hand : undefined}
                    showing={showing}
                    done={frame.done}
                  />
                )}
                {wide && !still && stake !== null && stake !== undefined && stake > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-surface-1/60 py-0.5 pr-2 pl-1 text-sm whitespace-nowrap text-muted tabular-nums">
                    <ChipStack amount={stake} size="sm" />
                    {formatChips(stake)}
                  </span>
                )}
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
