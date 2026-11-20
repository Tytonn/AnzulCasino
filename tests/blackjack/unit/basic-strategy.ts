/**
 * Basic strategy for these exact rules: six decks, the dealer stands on soft
 * 17, double on any two cards, double after a split, split once, split aces
 * get one card, the dealer peeks, no surrender. Played over millions of
 * hands it shows the house edge the spec expects ("about 0.5% with good
 * play"). Test code only: the room never tells a player what to do.
 */
import {
  type BlackjackDetail,
  type Card,
  cardValue,
  handTotal,
  isPair,
  legalMoves,
  type Move,
} from '../../../shared/games/blackjack.ts'
import {
  type CardSource,
  deal,
  isOver,
  play,
  type Table,
} from '../../../server/games/blackjack/rules.ts'

/** The dealer's up card as the charts read it: 2 to 10, and 11 for an ace. */
function upValue(card: Card): number {
  const value = cardValue(card)
  return value === 1 ? 11 : value
}

function pairMove(value: number, up: number): Move | null {
  switch (value) {
    case 1:
    case 8:
      return 'split'
    case 10:
      return 'stand'
    case 9:
      return up === 7 || up >= 10 ? 'stand' : 'split'
    case 7:
      return up <= 7 ? 'split' : 'hit'
    case 6:
      return up <= 6 ? 'split' : 'hit'
    case 4:
      return up === 5 || up === 6 ? 'split' : 'hit'
    case 2:
    case 3:
      return up <= 7 ? 'split' : 'hit'
    default:
      return null // a pair of fives plays as a hard 10
  }
}

function softMove(total: number, up: number, canDouble: boolean): Move {
  const double = (from: number, to: number) => canDouble && up >= from && up <= to
  if (total >= 19) return 'stand'
  if (total === 18) {
    if (double(3, 6)) return 'double'
    return up >= 9 ? 'hit' : 'stand'
  }
  if (total === 17) return double(3, 6) ? 'double' : 'hit'
  if (total >= 15) return double(4, 6) ? 'double' : 'hit'
  return double(5, 6) ? 'double' : 'hit'
}

function hardMove(total: number, up: number, canDouble: boolean): Move {
  if (total >= 17) return 'stand'
  if (total >= 13) return up <= 6 ? 'stand' : 'hit'
  if (total === 12) return up >= 4 && up <= 6 ? 'stand' : 'hit'
  if (total === 11) return canDouble && up <= 10 ? 'double' : 'hit'
  if (total === 10) return canDouble && up <= 9 ? 'double' : 'hit'
  if (total === 9) return canDouble && up >= 3 && up <= 6 ? 'double' : 'hit'
  return 'hit'
}

/** The basic-strategy move for the hand being played. */
export function basicStrategy(detail: BlackjackDetail): Move {
  const legal = legalMoves(detail)
  const hand = detail.hands[detail.active ?? -1]
  const up = detail.dealer[0]
  if (!hand || !up || legal.length === 0) throw new Error('No hand to play')
  const dealer = upValue(up)
  if (legal.includes('split') && isPair(hand.cards)) {
    const move = pairMove(cardValue(hand.cards[0] as Card), dealer)
    if (move) return move
  }
  const canDouble = legal.includes('double')
  const { total, soft } = handTotal(hand.cards)
  return soft ? softMove(total, dealer, canDouble) : hardMove(total, dealer, canDouble)
}

/** A hand played out by basic strategy. */
export function playBasic(bet: bigint, source: CardSource): Table {
  const table = deal(bet, source)
  while (!isOver(table)) play(table, basicStrategy(table.detail), source)
  return table
}
