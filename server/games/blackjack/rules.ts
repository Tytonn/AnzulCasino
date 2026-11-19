/**
 * Blackjack's rules engine (spec: Games > Blackjack). Pure apart from the
 * cards: give it a card source and a table, and it deals, plays a move,
 * plays the dealer and settles the hands. No database here, which is what
 * lets the tests stack a deck for every rule and simulate millions of hands.
 *
 * The game draws from a `Shoe`: what is left of six decks after every card
 * already on the table, drawn one at a time with node:crypto at the moment
 * the card shows (rule 7, draw late). The only card drawn before it shows is
 * the hole card when the dealer has to peek for blackjack; it waits in
 * `table.hole`, which the round keeps in its secret.
 *
 * The functions change the table they are given.
 */
import {
  type BlackjackDetail,
  type BlackjackHand,
  type Card,
  cardsShown,
  DECK,
  DECKS,
  dealerDraws,
  dealerPeeks,
  handPayout,
  handResult,
  handTotal,
  isBust,
  isNatural,
  isTwentyOneInTwo,
  legalMoves,
  type Move,
  rankOf,
} from '../../../shared/games/blackjack.ts'
import { randomBelow } from '../../lib/rng.ts'

/** Where cards come from: the shoe in the game, a stacked deck in tests. */
export interface CardSource {
  draw(): Card
}

/**
 * What is left of six decks. Drawing takes a uniformly random card from the
 * cards still in it, so every hand is as good as a fresh shuffle.
 */
export class Shoe implements CardSource {
  private readonly cards: Card[]
  private left: number

  /** Six full decks, less the cards already dealt in this hand. */
  constructor(dealt: readonly Card[] = []) {
    this.cards = []
    for (let d = 0; d < DECKS; d++) this.cards.push(...DECK)
    this.left = this.cards.length
    for (const card of dealt) this.remove(card)
  }

  /** Cards still in the shoe. */
  get size(): number {
    return this.left
  }

  draw(): Card {
    if (this.left === 0) throw new Error('The shoe is empty')
    const i = randomBelow(this.left)
    const card = this.cards[i] as Card
    this.left--
    // Drawn cards collect at the end, so reset() can put them all back.
    this.cards[i] = this.cards[this.left] as Card
    this.cards[this.left] = card
    return card
  }

  /** Takes a card that is already on the table out of the shoe. */
  remove(card: Card): void {
    const i = this.left === 0 ? -1 : this.cards.lastIndexOf(card, this.left - 1)
    if (i === -1) throw new Error(`More than ${DECKS} of ${card} on the table`)
    this.left--
    this.cards[i] = this.cards[this.left] as Card
    this.cards[this.left] = card
  }

  /** Puts every card back: six fresh decks for the next hand. */
  reset(): void {
    this.left = this.cards.length
  }
}

/** A round as the engine sees it: the public detail and the hole card, if the peek drew it. */
export interface Table {
  detail: BlackjackDetail
  /** The hole card while it lies face down. Only the peek draws it early. */
  hole: Card | null
}

/** Every card dealt so far, face up or down: what the shoe must not hold. */
export function dealtCards(table: Table): Card[] {
  const cards = cardsShown(table.detail)
  if (table.hole) cards.push(table.hole)
  return cards
}

/** The round is over: the dealer has turned the hole card over and every hand has a result. */
export function isOver(table: Table): boolean {
  const { detail } = table
  return (
    detail.active === null &&
    detail.hands.length > 0 &&
    detail.hands.every((hand) => hand.result !== null)
  )
}

function newHand(cards: Card[], stake: number): BlackjackHand {
  return { cards, stake, doubled: false, done: false, result: null, payout: null }
}

/**
 * Deals a hand for `bet` (hundredths): a card to the player, the dealer's up
 * card, the player's second card. With an ace or a ten up, the dealer draws
 * the hole card and peeks. A dealer blackjack, or the player's, ends the
 * round at once; otherwise the player's first hand is up.
 */
export function deal(
  bet: bigint,
  source: CardSource,
  options: { slowReveal?: boolean } = {},
): Table {
  const first = source.draw()
  const up = source.draw()
  const second = source.draw()
  const stake = Number(bet)
  const table: Table = {
    detail: {
      bet: stake,
      hands: [newHand([first, second], stake)],
      active: 0,
      dealer: [up],
      peeked: false,
      moves: [],
      slowReveal: options.slowReveal ?? false,
      idle: false,
    },
    hole: null,
  }
  if (dealerPeeks(up)) {
    table.detail.peeked = true
    table.hole = source.draw()
    if (isTwentyOneInTwo([up, table.hole])) return finish(table, source)
  }
  const hand = table.detail.hands[0] as BlackjackHand
  if (isNatural(table.detail, hand)) {
    hand.done = true
    return finish(table, source)
  }
  return table
}

/**
 * The stake side of a move, before any card: a double doubles the hand's
 * stake, a split makes two hands of one card each. Records the move. The
 * game takes the extra stake between this and `drawFor`, so the stake is
 * down before the card exists.
 */
export function commit(table: Table, move: Move): void {
  const { detail } = table
  if (!legalMoves(detail).includes(move)) {
    throw new Error(`${move} is not open on this hand`)
  }
  const index = detail.active as number
  const hand = detail.hands[index] as BlackjackHand
  detail.moves.push({ hand: index, move })
  if (move === 'double') {
    hand.doubled = true
    hand.stake = detail.bet * 2
  } else if (move === 'split') {
    const [a, b] = hand.cards as [Card, Card]
    detail.hands = [newHand([a], detail.bet), newHand([b], detail.bet)]
  }
}

/** A split hand's second card: split aces take this one card and stop, and 21 stands. */
function dealSecond(table: Table, index: number, source: CardSource): void {
  const hand = table.detail.hands[index] as BlackjackHand
  hand.cards.push(source.draw())
  const splitAce = table.detail.hands.length > 1 && rankOf(hand.cards[0] as Card) === 'A'
  if (splitAce || handTotal(hand.cards).total >= 21) hand.done = true
}

/**
 * The card side of a move `commit` recorded: a hit or a double draws a card,
 * a split deals the first hand its second card, a stand draws nothing. Then
 * play moves on to the next hand, and once the player's turn is over the
 * dealer plays and the hands settle.
 */
export function drawFor(table: Table, move: Move, source: CardSource): Table {
  const { detail } = table
  const index = detail.active as number
  const hand = detail.hands[index] as BlackjackHand
  switch (move) {
    case 'hit':
      hand.cards.push(source.draw())
      // A bust ends the hand, and so does 21: there is nothing better to hit for.
      if (handTotal(hand.cards).total >= 21) hand.done = true
      break
    case 'double':
      hand.cards.push(source.draw())
      hand.done = true
      break
    case 'split':
      dealSecond(table, index, source)
      break
    case 'stand':
      hand.done = true
      break
  }
  return advance(table, source)
}

/** Plays a whole move: `commit`, then `drawFor`. */
export function play(table: Table, move: Move, source: CardSource): Table {
  commit(table, move)
  return drawFor(table, move, source)
}

/** Moves past finished hands, dealing a split hand its second card when its turn comes. */
function advance(table: Table, source: CardSource): Table {
  const { detail } = table
  while (detail.active !== null && (detail.hands[detail.active] as BlackjackHand).done) {
    const next = detail.active + 1
    if (next >= detail.hands.length) {
      detail.active = null
      break
    }
    detail.active = next
    if ((detail.hands[next] as BlackjackHand).cards.length === 1) dealSecond(table, next, source)
  }
  return detail.active === null ? finish(table, source) : table
}

/**
 * The dealer's turn and the settle: the hole card turns over (the one the
 * peek drew, or one drawn now), the dealer draws to 17 if any hand is still
 * in play, and every hand gets its result and payout.
 */
function finish(table: Table, source: CardSource): Table {
  const { detail } = table
  detail.active = null
  detail.dealer.push(table.hole ?? source.draw())
  table.hole = null
  const contested = detail.hands.some((hand) => !isBust(hand.cards) && !isNatural(detail, hand))
  if (contested) while (dealerDraws(detail.dealer)) detail.dealer.push(source.draw())
  for (const hand of detail.hands) {
    hand.done = true
    hand.result = handResult(detail, hand)
    hand.payout = Number(handPayout(BigInt(hand.stake), hand.result))
  }
  return table
}

/**
 * The safest rule for a hand left idle (spec: The room model: blackjack
 * stands): every hand still in play stands, after a split hand gets the
 * second card the rules owe it, and the dealer plays it out.
 */
export function standAll(table: Table, source: CardSource): Table {
  const { detail } = table
  if (detail.active === null) return isOver(table) ? table : finish(table, source)
  for (let i = detail.active; i < detail.hands.length; i++) {
    const hand = detail.hands[i] as BlackjackHand
    if (hand.cards.length === 1) dealSecond(table, i, source)
    hand.done = true
  }
  detail.idle = true
  detail.active = null
  return finish(table, source)
}
