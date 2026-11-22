/**
 * Blackjack (spec: Games > Blackjack). Six decks, shuffled fresh for every
 * hand. The dealer stands on all 17s. Blackjack pays 3 to 2. Double on any
 * first two cards, split once, double after a split, and split aces get one
 * card each. No surrender and no insurance. With an ace or a ten showing,
 * the dealer checks the hole card for blackjack before anyone plays, and a
 * push hands the stake back.
 *
 * What the browser and the server share lives here: the cards, the round's
 * public detail, the inputs, the hand math, the payouts and the words for
 * the ticker. The cards themselves are drawn on the server, one at a time
 * from what is left of the six decks, at the moment each one shows (rule 7,
 * draw late). Only a hole card the peek needs is drawn early, and it waits
 * in the round's secret.
 */
import { z } from 'zod'

import { mulDiv } from '../chips.ts'
import { BetText } from '../rounds.ts'

export const BLACKJACK = 'blackjack'

// ---------------------------------------------------------------- the rules

/** Decks in the shoe, shuffled fresh for every hand. */
export const DECKS = 6
/** The dealer draws to 16 and stands on every 17, soft 17 included. */
export const DEALER_STANDS_ON = 17
/** What a natural blackjack pays on top of the stake: 3 to 2. */
export const BLACKJACK_PAYS = { numerator: 3n, denominator: 2n } as const
/** One split per hand, so a round holds at most two hands. */
export const MAX_HANDS = 2
/**
 * The smallest hard total one more card can bust. The slow reveal plays for
 * a big bet's hit from here up, whatever the card turns out to be.
 */
export const BUST_RISK_FROM = 12

// ---------------------------------------------------------------- cards

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const
export const SUITS = ['s', 'h', 'd', 'c'] as const
export type Rank = (typeof RANKS)[number]
export type Suit = (typeof SUITS)[number]

/** A card as two letters, rank then suit: "As" is the ace of spades, "Th" the ten of hearts. */
export type Card = `${Rank}${Suit}`

/** Every card in one deck, by suit then rank. */
export const DECK: readonly Card[] = SUITS.flatMap((suit) =>
  RANKS.map((rank): Card => `${rank}${suit}`),
)

export function isCard(value: unknown): value is Card {
  return (
    typeof value === 'string' &&
    value.length === 2 &&
    (RANKS as readonly string[]).includes(value[0] as string) &&
    (SUITS as readonly string[]).includes(value[1] as string)
  )
}

export function rankOf(card: Card): Rank {
  return card[0] as Rank
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit
}

const VALUES: Record<Rank, number> = {
  A: 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 10,
  Q: 10,
  K: 10,
}

/** What a card counts: 1 for an ace (which a hand may count as 11), 10 for a ten or a face. */
export function cardValue(card: Card): number {
  return VALUES[rankOf(card)]
}

/** The rank as printed on the card's corner: A, 2 ... 10, J, Q, K. */
export function rankLabel(card: Card): string {
  const rank = rankOf(card)
  return rank === 'T' ? '10' : rank
}

const RANK_WORDS: Record<Rank, string> = {
  A: 'Ace',
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  T: 'Ten',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
}

const SUIT_WORDS: Record<Suit, string> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
}

/** The card in words, for screen readers: "Ace of spades". */
export function cardName(card: Card): string {
  return `${RANK_WORDS[rankOf(card)]} of ${SUIT_WORDS[suitOf(card)]}`
}

/** Hearts and diamonds are red. */
export function isRed(card: Card): boolean {
  const suit = suitOf(card)
  return suit === 'h' || suit === 'd'
}

// ---------------------------------------------------------------- hands

export interface HandTotal {
  /** The best total: an ace counts 11 when that does not bust the hand. */
  total: number
  /** An ace is counted as 11, so one more card cannot bust the hand. */
  soft: boolean
}

export function handTotal(cards: readonly Card[]): HandTotal {
  let total = 0
  let ace = false
  for (const card of cards) {
    const value = cardValue(card)
    total += value
    if (value === 1) ace = true
  }
  if (ace && total + 10 <= 21) return { total: total + 10, soft: true }
  return { total, soft: false }
}

export function isBust(cards: readonly Card[]): boolean {
  return handTotal(cards).total > 21
}

/** Two cards that make 21. On the dealer's side, or an unsplit hand's, that is a blackjack. */
export function isTwentyOneInTwo(cards: readonly Card[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21
}

/** The dealer shows an ace or a ten-value card, so checks the hole card for blackjack first. */
export function dealerPeeks(upCard: Card): boolean {
  const value = cardValue(upCard)
  return value === 1 || value === 10
}

/** The dealer draws another card below 17 and stands on every 17. */
export function dealerDraws(cards: readonly Card[]): boolean {
  return handTotal(cards).total < DEALER_STANDS_ON
}

/** How the total reads on a hand's badge: "17", "7/17" while soft, or "Bust". */
export function totalLabel(cards: readonly Card[]): string {
  const { total, soft } = handTotal(cards)
  if (total > 21) return String(total)
  if (soft && total !== 21) return `${total - 10}/${total}`
  return String(total)
}

// ---------------------------------------------------------------- the round's public detail

export const MOVES = ['hit', 'stand', 'double', 'split'] as const
export type Move = (typeof MOVES)[number]

export const MOVE_NAMES: Record<Move, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
}

/** The key for each move (spec: H hit, S stand, D double, P split). */
export const MOVE_KEYS: Record<Move, string> = { hit: 'h', stand: 's', double: 'd', split: 'p' }

export const HAND_RESULTS = ['blackjack', 'win', 'push', 'lose', 'bust'] as const
export type HandResult = (typeof HAND_RESULTS)[number]

export interface BlackjackHand {
  /** In the order they were dealt. */
  cards: Card[]
  /** Chips riding on this hand: the bet, or twice it once doubled. */
  stake: number
  doubled: boolean
  /** Play on this hand is over: it stood, bust, doubled, reached 21, or is a split ace with its card. */
  done: boolean
  /** How the hand ended, once the round settles. */
  result: HandResult | null
  /** Everything the hand paid back, stake included, once the round settles. Chips. */
  payout: number | null
}

/** One of the player's decisions, in order, for the replay. */
export interface BlackjackMove {
  hand: number
  move: Move
}

/** A blackjack round's public detail: enough to draw the table and to replay the hand. */
export interface BlackjackDetail {
  /** Chips bet on the first hand: what a double or a split adds. 0 only before the deal. */
  bet: number
  /** One hand, or two after a split. Empty only between the bet and the deal. */
  hands: BlackjackHand[]
  /** The hand being played, or null when none is: before the deal, and once the player's turn ends. */
  active: number | null
  /**
   * The dealer's face-up cards in the order they turned over. While the round
   * is open this is the up card alone: the hole card lies face down, and
   * unless the dealer peeked it has not been drawn yet.
   */
  dealer: Card[]
  /** The dealer checked the hole card for blackjack, because an ace or a ten was showing. */
  peeked: boolean
  /** The player's decisions in order. */
  moves: BlackjackMove[]
  /**
   * The bet was all in, or over blackjack_slow_reveal_pct of the wallet when
   * it was placed (or grew there with a double or split). Such a hand gets
   * the slow reveal: a hit from a hard 12 or more, and the dealer's hole
   * card, come out face down, lift slowly and then flip. It depends only on
   * the bet, never on a card, so it gives nothing away.
   */
  slowReveal: boolean
  /** The table finished the hand by standing, after the player left it idle too long. */
  idle: boolean
}

/** What a round keeps hidden: the hole card, drawn at the deal only when the dealer peeks. */
export interface BlackjackSecret {
  hole: Card
}

/** The detail of a round whose bet is placed but not dealt yet. */
export function undealt(): BlackjackDetail {
  return {
    bet: 0,
    hands: [],
    active: null,
    dealer: [],
    peeked: false,
    moves: [],
    slowReveal: false,
    idle: false,
  }
}

/** Every card on the table, face up: the hands' and the dealer's. */
export function cardsShown(detail: BlackjackDetail): Card[] {
  return [...detail.hands.flatMap((hand) => hand.cards), ...detail.dealer]
}

/** A natural: the first two cards of an unsplit hand making 21. Split hands never are one. */
export function isNatural(detail: BlackjackDetail, hand: BlackjackHand): boolean {
  return detail.hands.length === 1 && isTwentyOneInTwo(hand.cards)
}

/** The dealer turned over a blackjack. */
export function dealerHasBlackjack(detail: BlackjackDetail): boolean {
  return isTwentyOneInTwo(detail.dealer)
}

/** The two cards are worth the same, so they can be split: a pair, or any two ten-value cards. */
export function isPair(cards: readonly Card[]): boolean {
  const [a, b] = cards
  return cards.length === 2 && a !== undefined && b !== undefined && cardValue(a) === cardValue(b)
}

/** The moves the rules allow now, before the wallet is checked. */
export function legalMoves(detail: BlackjackDetail): Move[] {
  if (detail.active === null) return []
  const hand = detail.hands[detail.active]
  if (!hand || hand.done) return []
  const moves: Move[] = ['hit', 'stand']
  if (hand.cards.length === 2) {
    moves.push('double')
    if (detail.hands.length < MAX_HANDS && isPair(hand.cards)) moves.push('split')
  }
  return moves
}

/** Chips a move takes from the wallet: a double or a split adds the bet again. */
export function extraStake(detail: BlackjackDetail, move: Move): number {
  return move === 'double' || move === 'split' ? detail.bet : 0
}

/** Why a move cannot be made now, in plain words, or null when it can. */
export function whyNot(detail: BlackjackDetail, move: Move): string | null {
  if (detail.active === null) return 'This hand is over. Deal the next one.'
  if (legalMoves(detail).includes(move)) return null
  const hand = detail.hands[detail.active]
  if (move === 'double') return 'You can only double on your first two cards.'
  if (move === 'split') {
    if (detail.hands.length >= MAX_HANDS) return 'You can split once per hand.'
    if (hand && hand.cards.length !== 2) return 'You can only split your first two cards.'
    return 'You can only split two cards of the same value.'
  }
  return 'That move is not open right now.'
}

/**
 * Whether the next card to this hand gets the slow reveal: the round's bet
 * is big, and the hand stands on a hard 12 or more, where one card can bust
 * it. Decided from the hand before the card, never from the card.
 */
export function slowHitFor(detail: BlackjackDetail, hand: Pick<BlackjackHand, 'cards'>): boolean {
  if (!detail.slowReveal) return false
  const { total, soft } = handTotal(hand.cards)
  return !soft && total >= BUST_RISK_FROM
}

/**
 * Whether a bet is big enough for the slow reveal: all in, or over `pct`
 * basis points of the wallet before the stake left it. `stake` is the whole
 * stake on the table and `balanceAfter` what the wallet holds beside it.
 */
export function isSlowRevealBet(
  stake: bigint,
  balanceAfter: bigint,
  allIn: boolean,
  pct: number,
): boolean {
  if (allIn) return true
  return stake * 10_000n > (stake + balanceAfter) * BigInt(pct)
}

// ---------------------------------------------------------------- payouts

/** Everything a settled hand pays back, stake included, rounded down to a whole chip. */
export function handPayout(stake: bigint, result: HandResult): bigint {
  switch (result) {
    case 'blackjack':
      return stake + mulDiv(stake, BLACKJACK_PAYS.numerator, BLACKJACK_PAYS.denominator)
    case 'win':
      return stake * 2n
    case 'push':
      return stake
    case 'lose':
    case 'bust':
      return 0n
  }
}

/** How a finished hand fares against the dealer's finished hand. */
export function handResult(detail: BlackjackDetail, hand: BlackjackHand): HandResult {
  const natural = isNatural(detail, hand)
  const dealerNatural = dealerHasBlackjack(detail)
  if (natural) return dealerNatural ? 'push' : 'blackjack'
  if (dealerNatural) return 'lose'
  const player = handTotal(hand.cards).total
  if (player > 21) return 'bust'
  const dealer = handTotal(detail.dealer).total
  if (dealer > 21 || player > dealer) return 'win'
  return player === dealer ? 'push' : 'lose'
}

/** Everything the round pays back once settled: the hands' payouts added up. */
export function roundPayout(detail: BlackjackDetail): bigint {
  return detail.hands.reduce((sum, hand) => sum + BigInt(hand.payout ?? 0), 0n)
}

// ---------------------------------------------------------------- words

export const RESULT_NAMES: Record<HandResult, string> = {
  blackjack: 'Blackjack',
  win: 'Win',
  push: 'Push',
  lose: 'Lose',
  bust: 'Bust',
}

function handLine(detail: BlackjackDetail, hand: BlackjackHand): string {
  const player = handTotal(hand.cards).total
  const dealer = handTotal(detail.dealer).total
  switch (hand.result) {
    case 'blackjack':
      return 'Blackjack'
    case 'push':
      return isNatural(detail, hand) ? 'Push, both blackjack' : `Push on ${player}`
    case 'bust':
      return `Bust on ${player}`
    case 'lose':
      return dealerHasBlackjack(detail) ? 'Dealer blackjack' : `${dealer} beats ${player}`
    case 'win':
      return dealer > 21 ? `Dealer bust on ${dealer}` : `${player} beats ${dealer}`
    case null:
      return 'In play'
  }
}

const SHORT: Record<HandResult, string> = {
  blackjack: 'blackjack',
  win: 'won',
  push: 'push',
  lose: 'lost',
  bust: 'bust',
}

/** One line for the ticker and History: "Blackjack", "20 beats 18", "Split: won 20, bust 24". */
export function summarize(detail: BlackjackDetail): string {
  const [first] = detail.hands
  if (!first) return 'No cards dealt'
  const idle = detail.idle ? ' (stood for an idle hand)' : ''
  if (detail.hands.length === 1) {
    const line = handLine(detail, first)
    return `${first.doubled ? `Doubled, ${line.charAt(0).toLowerCase()}${line.slice(1)}` : line}${idle}`
  }
  const parts = detail.hands.map((hand) => {
    const total = handTotal(hand.cards).total
    const word = hand.result ? SHORT[hand.result] : 'in play'
    return `${word} ${total}${hand.doubled ? ' doubled' : ''}`
  })
  return `Split: ${parts.join(', ')}${idle}`
}

// ---------------------------------------------------------------- inputs

/** POST /api/blackjack/deal: what the player typed in the bet box. */
export const BlackjackDealInput = z.strictObject({ bet: BetText })
export type BlackjackDealInput = z.infer<typeof BlackjackDealInput>

/**
 * POST /api/blackjack/move. The round and its step count are the ones the
 * player saw, so a move made in a tab that fell behind is refused instead
 * of landing on a hand that has changed.
 */
export const BlackjackMoveInput = z.strictObject({
  move: z.enum(MOVES, { error: 'Pick hit, stand, double or split.' }),
  roundId: z.int({ error: 'Reload the page to see your hand.' }).positive(),
  steps: z.int({ error: 'Reload the page to see your hand.' }).nonnegative(),
})
export type BlackjackMoveInput = z.infer<typeof BlackjackMoveInput>
