/**
 * How a hand comes onto the table, one card at a time. The server answers
 * each move with the whole hand; the table shows what changed in the order a
 * dealer deals it: the player, the dealer's up card, the player, the
 * dealer's face-down card; then each new card in hand order; then the hole
 * card turns over, the dealer draws, and the results show.
 *
 * A `Frame` is how much of the round is showing. `nextStep` moves a frame
 * one card closer to the round, so any answer animates from whatever is on
 * the table, and a page load shows the round at once with `finalFrame`.
 * Pure functions: the room plays them with timers (useTimeline.ts).
 */
import {
  type BlackjackDetail,
  type Card,
  dealerPeeks,
  isBust,
  isNatural,
  slowHitFor,
} from '../../../shared/games/blackjack.ts'

/** The parts of a round the table needs. */
export interface TableRound {
  id: number
  status: string
  detail: BlackjackDetail
}

export interface Frame {
  /** The split has happened: two hands on the table. */
  split: boolean
  /** Cards showing in each hand: one count before the split, two after. */
  cards: number[]
  /** Dealer cards face up. */
  dealer: number
  /** A face-down card beside the dealer's up card. */
  hole: boolean
  /** The results are showing. */
  done: boolean
}

export type Step =
  | { kind: 'player'; hand: number; index: number }
  | { kind: 'up' }
  | { kind: 'hole' }
  | { kind: 'split' }
  | { kind: 'flip' }
  | { kind: 'dealer'; index: number }
  | { kind: 'results' }

export const EMPTY_FRAME: Frame = { split: false, cards: [0], dealer: 0, hole: false, done: false }

/** The round fully shown: what a page load draws at once. */
export function finalFrame(round: TableRound): Frame {
  const { detail } = round
  if (detail.hands.length === 0) return EMPTY_FRAME
  const over = round.status !== 'open'
  return {
    split: detail.hands.length > 1,
    cards: detail.hands.map((hand) => hand.cards.length),
    dealer: over ? detail.dealer.length : Math.min(1, detail.dealer.length),
    hole: !over,
    done: over,
  }
}

export function sameFrame(a: Frame, b: Frame): boolean {
  return (
    a.split === b.split &&
    a.dealer === b.dealer &&
    a.hole === b.hole &&
    a.done === b.done &&
    a.cards.length === b.cards.length &&
    a.cards.every((n, i) => n === b.cards[i])
  )
}

/** The next card to show, and the frame once it shows, or null when the round is all showing. */
export function nextStep(frame: Frame, round: TableRound): { step: Step; frame: Frame } | null {
  const target = finalFrame(round)
  if (round.detail.hands.length === 0) return null
  const shown = (i: number) => frame.cards[i] ?? 0
  // The deal: the player, the dealer's up card, the player again, then the hole card.
  if (!frame.split) {
    if (shown(0) < 1)
      return { step: { kind: 'player', hand: 0, index: 0 }, frame: { ...frame, cards: [1] } }
    if (frame.dealer < 1) return { step: { kind: 'up' }, frame: { ...frame, dealer: 1 } }
    if (shown(0) < 2)
      return { step: { kind: 'player', hand: 0, index: 1 }, frame: { ...frame, cards: [2] } }
  }
  if (frame.dealer < 2 && !frame.hole) {
    return { step: { kind: 'hole' }, frame: { ...frame, hole: true } }
  }
  if (target.split && !frame.split) {
    return { step: { kind: 'split' }, frame: { ...frame, split: true, cards: [1, 1] } }
  }
  for (let i = 0; i < target.cards.length; i++) {
    if (shown(i) < (target.cards[i] ?? 0)) {
      const cards = target.cards.map((_, j) => shown(j))
      cards[i] = shown(i) + 1
      return { step: { kind: 'player', hand: i, index: shown(i) }, frame: { ...frame, cards } }
    }
  }
  if (target.dealer >= 2 && frame.hole) {
    return { step: { kind: 'flip' }, frame: { ...frame, hole: false, dealer: 2 } }
  }
  if (frame.dealer < target.dealer) {
    return {
      step: { kind: 'dealer', index: frame.dealer },
      frame: { ...frame, dealer: frame.dealer + 1 },
    }
  }
  if (target.done && !frame.done) {
    return { step: { kind: 'results' }, frame: { ...frame, done: true } }
  }
  return null
}

export interface ShownCard {
  /** Stable through the split, so a card slides to its new hand. */
  key: string
  card: Card
}

/** The player's cards showing in a frame: one hand before the split, two after. */
export function shownHands(detail: BlackjackDetail, frame: Frame): ShownCard[][] {
  const [first, second] = detail.hands
  if (!first) return [[]]
  if (!frame.split) {
    // Before the split shows, a split round's hands are still the pair that was dealt.
    const cards = second ? [first.cards[0], second.cards[0]] : first.cards
    return [
      cards
        .slice(0, frame.cards[0] ?? 0)
        .filter((card): card is Card => card !== undefined)
        .map((card, j) => ({ key: j < 2 ? `p${j}` : `h0-${j}`, card })),
    ]
  }
  return detail.hands.map((hand, i) =>
    hand.cards
      .slice(0, frame.cards[i] ?? 0)
      .map((card, j) => ({ key: j === 0 ? `p${i}` : `h${i}-${j}`, card })),
  )
}

/** The dealer's face-up cards in a frame. */
export function shownDealer(detail: BlackjackDetail, frame: Frame): ShownCard[] {
  return detail.dealer.slice(0, frame.dealer).map((card, j) => ({ key: `d${j}`, card }))
}

/** The hand a step's card lands in, as it shows after the step. */
export function handAt(detail: BlackjackDetail, frame: Frame, hand: number): Card[] {
  return (shownHands(detail, frame)[hand] ?? []).map((c) => c.card)
}

/**
 * Whether a step gets the slow reveal (Tyton, Nov 19, 2026): on a big bet,
 * a hit or a double from a hard 12 or more, and the dealer's hole card when
 * a hand is still waiting on it. It depends on the spot, never on the card.
 */
export function isSlowStep(step: Step, round: TableRound, before: Frame): boolean {
  const { detail } = round
  if (!detail.slowReveal) return false
  if (step.kind === 'player') {
    // The deal and a split hand's second card are not hits.
    if (step.index < 2) return false
    return slowHitFor(detail, { cards: handAt(detail, before, step.hand) })
  }
  if (step.kind === 'flip') {
    return detail.hands.some((hand) => !isBust(hand.cards) && !isNatural(detail, hand))
  }
  return false
}

/** How long each kind of step holds the table, in milliseconds. */
export interface Pace {
  deal: number
  hit: number
  split: number
  flip: number
  dealer: number
  /** The dealer checking under an ace or a ten: the same length whatever is there. */
  peek: number
  /** After a slow card turns over, before play goes on. */
  land: number
  /** The last hand's cards going to the discard pile, before a new deal comes out. */
  sweep: number
}

export const PACE: Pace = {
  deal: 230,
  hit: 320,
  split: 420,
  flip: 430,
  dealer: 520,
  peek: 700,
  land: 420,
  sweep: 300,
}
export const REDUCED_PACE: Pace = {
  deal: 70,
  hit: 100,
  split: 120,
  flip: 120,
  dealer: 160,
  peek: 250,
  land: 200,
  sweep: 120,
}

/** The slow reveal's timings, from the config. */
export interface SlowPace {
  /** The face-down card lifting. */
  lift: number
  /** The card turning over. */
  turn: number
}

/** How long a step holds the table before the next one, for a step that is not slow. */
export function stepMs(step: Step, detail: BlackjackDetail, pace: Pace): number {
  switch (step.kind) {
    case 'player':
      return step.index < 2 ? pace.deal : pace.hit
    case 'up':
      return pace.deal
    case 'hole': {
      const up = detail.dealer[0]
      return pace.deal + (up && dealerPeeks(up) ? pace.peek : 0)
    }
    case 'split':
      return pace.split
    case 'flip':
      return pace.flip
    case 'dealer':
      return pace.dealer
    case 'results':
      return 0
  }
}

/** How long the slow reveal holds a step: the lift, the turn, then the landing. */
export function slowMs(slow: SlowPace, pace: Pace): number {
  return slow.lift + slow.turn + pace.land
}

/**
 * About how long a settled round takes to show on its player's own table,
 * from the moment the last answer arrives. Another player's seat waits this
 * long before it shows the result, so nobody sees it before they do.
 */
export function revealMs(round: TableRound, pace: Pace, slow: SlowPace): number {
  const final = finalFrame(round)
  if (!final.done) return 0
  const last = round.detail.moves.at(-1)
  let frame: Frame = EMPTY_FRAME
  // A deal may wait for the last hand's cards to clear first.
  let ms = last ? 0 : pace.sweep
  if (last) {
    const cards = [...final.cards]
    if ((last.move === 'hit' || last.move === 'double') && cards[last.hand] !== undefined) {
      cards[last.hand] = (cards[last.hand] ?? 1) - 1
    }
    frame = { split: final.split, cards, dealer: 1, hole: true, done: false }
  }
  for (let i = 0; i < 40; i++) {
    const next = nextStep(frame, round)
    if (!next) break
    ms += isSlowStep(next.step, round, frame)
      ? slowMs(slow, pace)
      : stepMs(next.step, round.detail, pace)
    frame = next.frame
  }
  return ms
}
