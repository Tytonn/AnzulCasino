/**
 * The felt: the dealer's cards at the top, yours at the bottom, and between
 * them the lettering, or what just happened. It draws whatever a frame of
 * the round shows (timeline.ts), so the room animates a hand by stepping the
 * frame, and the History replay draws the finished hand with the same
 * component.
 *
 * The table measures the space its seat gives it and sizes the cards to fit
 * (layout.ts). Every card is placed by hand from the middle of the table, so
 * a new card flies in face down from the shoe at the top right and turns
 * over as it lands, a split slides the second card over to its own hand,
 * and a new deal sweeps the old cards to the discard pile at the top left.
 */
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'motion/react'
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

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
import { CardBack, PlayingCard } from './Card.tsx'
import { handCenters, handSpan, spread, type TableLayout, tableLayout } from './layout.ts'
import {
  EMPTY_FRAME,
  type Frame,
  type Pace,
  sameFrame,
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
  /** A finished hand in History: smaller, as tall as its cards, with no shoe. */
  still?: boolean
}

/** How long a dealt card takes to show its face: its total counts from then. */
const LAND_MS = 170

/**
 * The frame as far as its cards have landed, for the totals: a total changes
 * when its card turns face up, not while the card is still on its way.
 */
function useLanded(roundId: number, frame: Frame): Frame {
  const [landed, setLanded] = useState({ roundId, frame })
  useEffect(() => {
    if (landed.roundId === roundId && sameFrame(landed.frame, frame)) return
    const timer = setTimeout(() => setLanded({ roundId, frame }), LAND_MS)
    return () => clearTimeout(timer)
  }, [roundId, frame, landed])
  return landed.roundId === roundId ? landed.frame : EMPTY_FRAME
}

/** The size of an element, kept up to date. */
function useBox() {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      setBox((old) => (old?.width === width && old.height === height ? old : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, box] as const
}

interface Placed {
  key: string
  card: Card | null
  down: boolean
  /** The card's left edge, from the middle of the table. */
  x: number
  rotate: number
  z: number
}

/** A hand's cards placed around its middle. A double's third card lies sideways. */
function place(
  cards: { key: string; card: Card | null; down?: boolean }[],
  center: number,
  width: number,
  doubled: boolean,
): Placed[] {
  const step = spread(cards.length) * width
  const span = handSpan(cards.length, width)
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

/** One row of cards. New cards fly in from the shoe; cleared ones go to the discard pile. */
function CardRow({
  placed,
  roundId,
  layout,
  top,
  slowKey,
  slow,
  slowPace,
  peekKey,
  peekMs,
}: {
  placed: Placed[]
  roundId: number
  layout: TableLayout
  /** The row's top, for the flight from the shoe. */
  top: number
  slowKey: string | null
  slow: SlowPhase | null
  slowPace: SlowPace
  peekKey: string | null
  peekMs: number
}) {
  const reduced = useReducedMotion()
  const { card, cardHeight, shoe } = layout
  const scale = shoe.card / card
  const y = shoe.y - top - cardHeight / 2
  const fromShoe = shoe.x - card / 2
  const toDiscard = -shoe.x - card / 2
  return (
    <AnimatePresence initial={false}>
      {placed.map((c) => (
        <motion.div
          key={`${roundId}:${c.key}`}
          className="absolute top-0 left-1/2"
          style={{ zIndex: c.z }}
          initial={
            reduced
              ? { opacity: 0, x: c.x, y: 0, rotate: c.rotate }
              : { opacity: 0, x: fromShoe, y, rotate: -8, scale }
          }
          animate={{ opacity: 1, x: c.x, y: 0, rotate: c.rotate, scale: 1 }}
          exit={
            reduced
              ? { opacity: 0, transition: { duration: 0.12 } }
              : {
                  opacity: 0,
                  x: toDiscard,
                  y,
                  rotate: 10,
                  scale,
                  transition: {
                    duration: 0.3,
                    ease: [0.45, 0, 0.55, 1],
                    opacity: { duration: 0.3, ease: [0.7, 0, 1, 1] },
                    delay: c.z * 0.025,
                  },
                }
          }
          transition={{
            type: 'spring',
            stiffness: 360,
            damping: 32,
            mass: 0.8,
            opacity: { duration: 0.1 },
          }}
        >
          <PlayingCard
            card={c.card}
            faceUp={!c.down}
            dealt
            slow={c.key === slowKey ? slow : null}
            liftMs={slowPace.lift}
            turnMs={slowPace.turn}
            peekMs={c.key === peekKey ? peekMs : 0}
          />
        </motion.div>
      ))}
    </AnimatePresence>
  )
}

/** The shoe at the top right, or the discard pile at the top left. */
function Pile({
  x,
  y,
  card,
  discard = false,
}: {
  x: number
  y: number
  card: number
  discard?: boolean
}) {
  const height = Math.round(card * 1.4)
  const tilts = discard ? [-9, 5, 13] : [0, 0, 0, 0]
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute top-0 left-1/2 ${discard ? 'opacity-80' : ''}`}
      style={
        {
          width: card,
          height,
          transform: `translate(${x - card / 2}px, ${y - height / 2}px) rotate(${discard ? 4 : -8}deg)`,
          '--bj-card-w': `${card}px`,
        } as CSSProperties
      }
    >
      {tilts.map((tilt, i) => (
        <div
          key={i}
          className="absolute inset-0"
          style={{
            transform: discard ? `rotate(${tilt}deg)` : `translate(${-i * 1.2}px, ${-i * 1.6}px)`,
          }}
        >
          <CardBack flat />
        </div>
      ))}
    </div>
  )
}

/** The lettering on the felt, curved like a real table's. Fits the space between the rows. */
function Print({ band, width }: { band: number; width: number }) {
  const id = useId()
  const full = band >= 60
  const viewHeight = full ? 62 : 38
  const scale = Math.min(band / viewHeight, (width * 0.86) / 360, 1.35)
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 360 ${viewHeight}`}
      width={Math.round(360 * scale)}
      height={Math.round(viewHeight * scale)}
      className="bj-print pointer-events-none"
    >
      <defs>
        <path id={`${id}main`} d="M12 13 Q180 53 348 13" />
        <path id={`${id}rule`} d="M70 40 Q180 74 290 40" />
      </defs>
      <text fontSize="14.5" fontWeight="800" letterSpacing="3.6" textAnchor="middle">
        <textPath href={`#${id}main`} startOffset="50%">
          BLACKJACK PAYS 3 TO 2
        </textPath>
      </text>
      {full && (
        <text fontSize="8.5" fontWeight="700" letterSpacing="2.4" textAnchor="middle">
          <textPath href={`#${id}rule`} startOffset="50%">
            DEALER STANDS ON ALL 17s
          </textPath>
        </text>
      )}
    </svg>
  )
}

/** How far a row of placed cards reaches each way from the middle of the table. */
function reach(placed: Placed[], card: number): { left: number; right: number } {
  if (placed.length === 0) return { left: 0, right: 0 }
  let left = Infinity
  let right = -Infinity
  for (const c of placed) {
    const half = c.rotate === 90 ? card * 0.7 : card / 2
    left = Math.min(left, c.x + card / 2 - half)
    right = Math.max(right, c.x + card / 2 + half)
  }
  return { left, right }
}

/**
 * A pill beside a hand, on its `side`: just outside the cards, or pushed in
 * over their edge where it would run past `limit` (the table's edge, or the
 * shoe).
 */
function SidePill({
  side,
  edge,
  limit,
  top,
  height,
  dim = false,
  children,
}: {
  side: 'left' | 'right'
  edge: number
  limit: number
  top: number
  height: number
  dim?: boolean
  children: ReactNode
}) {
  const gap = 8
  const from = side === 'right' ? edge + gap : limit
  const to = side === 'right' ? limit : edge - gap
  return (
    <motion.div
      className={`pointer-events-none absolute left-1/2 z-20 flex items-center transition-opacity duration-250 ${side === 'right' ? 'justify-end' : 'justify-start'} ${dim ? 'opacity-55' : ''}`}
      style={{ top, height }}
      initial={false}
      animate={{ x: from, width: Math.max(0, to - from) }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
    >
      <div
        className={`flex min-w-full shrink-0 ${side === 'right' ? 'justify-start' : 'justify-end'}`}
      >
        {children}
      </div>
    </motion.div>
  )
}

type Tone = 'plain' | 'gold' | 'loss' | 'muted'
const TONES: Record<Tone, string> = {
  plain: 'bg-surface-3 text-text',
  gold: 'bg-gold text-on-gold',
  loss: 'bg-loss text-on-accent',
  muted: 'bg-surface-2 text-muted',
}

function Pill({
  children,
  tone = 'plain',
  compact,
  ref,
}: {
  children: ReactNode
  tone?: Tone
  compact: boolean
  ref?: Ref<HTMLSpanElement>
}) {
  return (
    <motion.span
      ref={ref}
      className={`inline-flex items-center justify-center rounded-full font-bold whitespace-nowrap tabular-nums shadow-card transition-colors duration-200 ${compact ? 'h-6 min-w-8 px-2 text-xs' : 'h-7 min-w-9 px-2.5 text-sm'} ${TONES[tone]}`}
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
    >
      {children}
    </motion.span>
  )
}

function signed(net: number): string {
  return net > 0 ? `+${formatChips(net)}` : net < 0 ? `−${formatChips(-net)}` : ''
}

/** What a hand's pill says: its total while it plays, its result once settled. */
function handPill(
  detail: BlackjackDetail,
  hand: BlackjackHand | undefined,
  showing: Card[],
  done: boolean,
): { text: ReactNode; tone: Tone } | null {
  if (showing.length === 0) return null
  if (done && hand?.result) {
    const tone: Tone =
      hand.result === 'win' || hand.result === 'blackjack'
        ? 'gold'
        : hand.result === 'push'
          ? 'muted'
          : 'loss'
    const net = (hand.payout ?? 0) - hand.stake
    return {
      tone,
      text: (
        <>
          {RESULT_NAMES[hand.result]}
          {net !== 0 && <span className="ml-1">{signed(net)}</span>}
        </>
      ),
    }
  }
  const natural =
    hand !== undefined &&
    detail.hands.length === 1 &&
    showing.length === 2 &&
    isNatural(detail, hand)
  if (natural) return { tone: 'gold', text: 'Blackjack' }
  const { total } = handTotal(showing)
  if (total > 21) return { tone: 'loss', text: `Bust ${total}` }
  // A soft total shows both ways until the hand stands on it.
  const stood = hand?.done === true && showing.length === hand.cards.length
  return { tone: total === 21 ? 'gold' : 'plain', text: stood ? total : totalLabel(showing) }
}

/** One line between the rows: what is happening, or how the hand ended. */
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

function Felt({
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
  layout,
  width,
}: TableProps & { layout: TableLayout; width: number }) {
  const reduced = useReducedMotion()
  const [yours, shake] = useAnimate<HTMLDivElement>()
  const { card, cardHeight, compact } = layout
  const detail = round?.detail ?? null
  const roundId = round?.id ?? 0
  const open = round?.status === 'open'
  // While a slow card is face down or turning, the totals leave it out.
  const hiding = slow === 'lift' || slow === 'turn'

  // Your hands, side by side once split.
  const hands = detail ? shownHands(detail, frame) : []
  const spans = hands.map((h) => handSpan(h.length, card))
  const widest = Math.max(0, ...spans)
  const centers = handCenters(spans, card)
  const player = hands.flatMap((cards, i) => {
    const hand = detail?.hands[frame.split ? i : 0]
    const doubled = hand?.doubled === true && (frame.split || detail?.hands.length === 1)
    return place(cards, centers[i] ?? 0, card, doubled)
  })

  // The dealer: the up card, then the hole card face down or turned over, then draws.
  const dealerShown = detail ? shownDealer(detail, frame) : []
  const dealerCards: { key: string; card: Card | null; down?: boolean }[] = [...dealerShown]
  if (frame.hole && detail) {
    dealerCards.push({ key: 'd1', card: open ? null : (detail.dealer[1] ?? null), down: true })
  }
  const dealer = place(dealerCards, 0, card, false)
  // The totals count a card once it lands, and never a slow card before it turns over.
  const landed = useLanded(roundId, frame)
  const dealerCount = Math.min(
    dealerShown.length,
    landed.dealer,
    hiding && step?.kind === 'flip' ? 1 : Infinity,
  )
  const dealerTotal = dealerShown.slice(0, dealerCount).map((c) => c.card)
  const dealerBust = isBust(dealerTotal)

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

  const line = middleLine(round, frame, step)
  const lineKey = `${roundId}:${frame.done}:${peekKey !== null}:${frame.split ? (detail?.active ?? 'x') : 'one'}`
  const spot = Math.round(card * 1.15)
  // The bet sits in the spot from the moment it is placed until the first card lands.
  const chips = pending ?? (open ? (round?.stake ?? null) : null)
  const active = open && frame.split && !frame.done && detail ? detail.active : null

  return (
    <div
      className="bj-table absolute inset-0 select-none"
      style={{ '--bj-card-w': `${card}px` } as CSSProperties}
      onClick={onTap}
    >
      {!still && <Pile x={-layout.shoe.x} y={layout.shoe.y} card={layout.shoe.card} discard />}
      {!still && <Pile x={layout.shoe.x} y={layout.shoe.y} card={layout.shoe.card} />}

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

      {/* The dealer, with the total beside the cards. */}
      <div className="absolute inset-x-0" style={{ top: layout.dealerTop, height: cardHeight }}>
        <CardRow
          placed={dealer}
          roundId={roundId}
          layout={layout}
          top={layout.dealerTop}
          slowKey={slowKey}
          slow={slow}
          slowPace={slowPace}
          peekKey={peekKey}
          peekMs={pace.peek}
        />
      </div>
      <SidePill
        side="right"
        edge={reach(dealer, card).right}
        limit={layout.shoe.x - layout.shoe.card * 0.6 - 6}
        top={layout.dealerTop}
        height={cardHeight}
      >
        <AnimatePresence>
          {dealerTotal.length > 0 && (
            <Pill key="dealer" tone={dealerBust ? 'loss' : 'muted'} compact={compact}>
              {!compact && (
                <span className="mr-1 text-[0.65em] font-semibold tracking-[0.14em] uppercase opacity-80">
                  Dealer
                </span>
              )}
              {dealerBust ? `Bust ${handTotal(dealerTotal).total}` : totalLabel(dealerTotal)}
            </Pill>
          )}
        </AnimatePresence>
      </SidePill>

      {/* Between the rows: the lettering, or what just happened. */}
      <div
        aria-live="polite"
        className={`absolute inset-x-0 z-10 flex items-center justify-center px-2 text-center ${compact ? 'text-sm' : 'text-base'}`}
        style={{ top: layout.bandTop, height: layout.band }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {line ? (
            <motion.span
              key={lineKey}
              className="max-w-full rounded-full bg-surface-1/75 px-3 py-1 shadow-card backdrop-blur-sm"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            >
              {line}
            </motion.span>
          ) : still ? null : (
            <motion.span
              key="print"
              className="flex"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.4, delay: 0.1 } }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              <Print band={layout.band} width={width} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* You: the betting spot on an empty table, then your cards. */}
      <AnimatePresence>
        {player.length === 0 && !still && (
          <motion.div
            key="spot"
            aria-hidden="true"
            className="absolute left-1/2 grid place-items-center"
            style={{
              top: layout.playerTop + (cardHeight - spot) / 2,
              width: spot,
              height: spot,
              marginLeft: -spot / 2,
            }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
          >
            <span className="bj-spot absolute inset-0 rounded-full" />
            {chips ? (
              <ChipStack amount={chips} size={compact ? 'sm' : 'md'} />
            ) : (
              <span className="bj-print text-[0.6rem] font-extrabold tracking-[0.24em] md:text-xs">
                BET
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The hand being played, once there are two. */}
      <AnimatePresence>
        {active !== null && (
          <motion.div
            key="active"
            aria-hidden="true"
            className="absolute left-1/2 rounded-lg bg-surface-1/30 ring-1 ring-accent/70"
            style={{ top: layout.playerTop - 6, height: cardHeight + 12 }}
            initial={{ opacity: 0, x: (centers[active] ?? 0) - widest / 2 - 8, width: widest + 16 }}
            animate={{ opacity: 1, x: (centers[active] ?? 0) - widest / 2 - 8, width: widest + 16 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 34 }}
          />
        )}
      </AnimatePresence>

      <div
        ref={yours}
        className="absolute inset-x-0"
        style={{ top: layout.playerTop, height: cardHeight }}
      >
        <CardRow
          placed={player}
          roundId={roundId}
          layout={layout}
          top={layout.playerTop}
          slowKey={slowKey}
          slow={slow}
          slowPace={slowPace}
          peekKey={null}
          peekMs={0}
        />
      </div>

      {/* Each hand's total or result beside it: to the right, or outside each hand once split. */}
      {detail &&
        hands.map((cards, i) => {
          const hand = detail.hands[frame.split ? i : 0]
          let count = cards.length
          if (landed.split === frame.split) count = Math.min(count, landed.cards[i] ?? 0)
          if (hiding && step?.kind === 'player' && step.hand === i) {
            count = Math.min(count, cards.length - 1)
          }
          const showing = cards.slice(0, count).map((c) => c.card)
          const label = handPill(
            detail,
            frame.split || detail.hands.length === 1 ? hand : undefined,
            showing,
            frame.done,
          )
          const keys = new Set(cards.map((c) => c.key))
          const { left, right } = reach(
            player.filter((c) => keys.has(c.key)),
            card,
          )
          const side = hands.length > 1 && i === 0 ? 'left' : 'right'
          return (
            <SidePill
              key={`label${i}${side}`}
              side={side}
              edge={side === 'left' ? left : right}
              limit={(side === 'left' ? -1 : 1) * (width / 2 - 8)}
              top={layout.playerTop}
              height={cardHeight}
              dim={open && frame.split && !frame.done && detail.active !== i}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {label && (
                  <Pill
                    key={`${roundId}:${frame.done ? 'done' : 'play'}`}
                    tone={label.tone}
                    compact={compact}
                  >
                    {label.text}
                  </Pill>
                )}
              </AnimatePresence>
            </SidePill>
          )
        })}
    </div>
  )
}

export function Table(props: TableProps) {
  const [ref, box] = useBox()
  if (props.still) {
    const width = box?.width ?? 320
    const layout = tableLayout(width, null, width < 480 ? 40 : 52)
    return (
      <div ref={ref} className="relative w-full" style={{ height: layout.height }}>
        <Felt {...props} layout={layout} width={width} />
      </div>
    )
  }
  const layout = box ? tableLayout(box.width, box.height) : null
  return (
    <>
      {/* Holds the seat open at the table's least height; the felt fills whatever the seat has. */}
      <div aria-hidden="true" className="w-full" style={{ height: layout?.minHeight ?? 172 }} />
      <div ref={ref} className="absolute inset-0">
        {layout && box && <Felt {...props} layout={layout} width={box.width} />}
      </div>
    </>
  )
}
