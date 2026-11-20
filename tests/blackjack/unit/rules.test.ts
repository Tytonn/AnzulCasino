/**
 * Blackjack's rules (spec: Games > Blackjack: "Tests. Every rule above,
 * payouts for every outcome"). The engine draws from a stacked deck here, so
 * each test deals exactly the cards it names, in order: the player, the
 * dealer's up card, the player, then the hole card if the dealer peeks, then
 * every later card as it is drawn.
 */
import { describe, expect, it } from 'vitest'

import {
  type BlackjackDetail,
  BlackjackDealInput,
  BlackjackMoveInput,
  type Card,
  cardName,
  cardValue,
  DECK,
  dealerDraws,
  dealerPeeks,
  extraStake,
  handPayout,
  handTotal,
  isPair,
  isSlowRevealBet,
  legalMoves,
  roundPayout,
  slowHitFor,
  summarize,
  totalLabel,
  undealt,
  whyNot,
} from '../../../shared/games/blackjack.ts'
import {
  type CardSource,
  commit,
  deal,
  dealtCards,
  drawFor,
  isOver,
  play,
  Shoe,
  standAll,
  type Table,
} from '../../../server/games/blackjack/rules.ts'

/** A deck that deals exactly these cards, in this order. */
function stack(...cards: Card[]): CardSource & { left(): number } {
  const queue = [...cards]
  return {
    draw() {
      const card = queue.shift()
      if (!card) throw new Error('The stacked deck ran out')
      return card
    },
    left: () => queue.length,
  }
}

const BET = 1_000n // 10 chips

function hand(table: Table, i = 0) {
  const found = table.detail.hands[i]
  if (!found) throw new Error(`No hand ${i}`)
  return found
}

/** Deals from a stacked deck and plays the moves, checking the deck was used up exactly. */
function run(cards: Card[], moves: ('hit' | 'stand' | 'double' | 'split')[] = [], bet = BET) {
  const deck = stack(...cards)
  const table = deal(bet, deck)
  for (const move of moves) play(table, move, deck)
  expect(deck.left(), 'cards left in the stacked deck').toBe(0)
  return table
}

describe('cards and totals', () => {
  it('counts aces as 1 or 11, faces as 10', () => {
    expect(cardValue('As')).toBe(1)
    expect(cardValue('Td')).toBe(10)
    expect(cardValue('Kc')).toBe(10)
    expect(cardValue('7h')).toBe(7)
    expect(handTotal(['As', '6d'])).toEqual({ total: 17, soft: true })
    expect(handTotal(['As', '6d', 'Th'])).toEqual({ total: 17, soft: false })
    expect(handTotal(['As', 'Ad'])).toEqual({ total: 12, soft: true })
    expect(handTotal(['As', 'Ad', '9c'])).toEqual({ total: 21, soft: true })
    expect(handTotal(['Ks', 'Qd', '2c'])).toEqual({ total: 22, soft: false })
  })

  it('shows soft totals both ways until they are 21', () => {
    expect(totalLabel(['As', '6d'])).toBe('7/17')
    expect(totalLabel(['As', 'Kd'])).toBe('21')
    expect(totalLabel(['9s', '7d'])).toBe('16')
    expect(totalLabel(['9s', '7d', 'Kc'])).toBe('26')
  })

  it('has 52 different cards in a deck and names them', () => {
    expect(new Set(DECK).size).toBe(52)
    expect(cardName('As')).toBe('Ace of spades')
    expect(cardName('Th')).toBe('Ten of hearts')
    expect(cardName('Qd')).toBe('Queen of diamonds')
  })

  it('pairs any two cards of the same value, ten-value cards included', () => {
    expect(isPair(['8s', '8d'])).toBe(true)
    expect(isPair(['Ks', 'Qd'])).toBe(true)
    expect(isPair(['Ts', 'Jd'])).toBe(true)
    expect(isPair(['As', 'Ad'])).toBe(true)
    expect(isPair(['9s', '8d'])).toBe(false)
    expect(isPair(['8s', '8d', '8c'])).toBe(false)
  })

  it('peeks with an ace or a ten-value card up, and draws to 16 and stands on all 17s', () => {
    for (const card of ['As', 'Ts', 'Js', 'Qs', 'Ks'] as Card[])
      expect(dealerPeeks(card)).toBe(true)
    for (const card of ['2s', '6s', '9s'] as Card[]) expect(dealerPeeks(card)).toBe(false)
    expect(dealerDraws(['Ts', '6d'])).toBe(true)
    expect(dealerDraws(['Ts', '7d'])).toBe(false)
    expect(dealerDraws(['As', '6d'])).toBe(false) // soft 17 stands
    expect(dealerDraws(['As', '5d'])).toBe(true) // soft 16 draws
  })
})

describe('the deal', () => {
  it('deals the player, the dealer, the player, and leaves the hole card undrawn with 2 to 9 up', () => {
    const table = run(['9s', '7h', '5d'])
    expect(hand(table).cards).toEqual(['9s', '5d'])
    expect(table.detail).toMatchObject({ dealer: ['7h'], peeked: false, active: 0, bet: 1_000 })
    expect(table.hole).toBeNull()
    expect(isOver(table)).toBe(false)
    expect(legalMoves(table.detail)).toEqual(['hit', 'stand', 'double'])
  })

  it('draws the hole card for the peek with an ace or a ten up, and keeps it face down', () => {
    const table = run(['9s', 'Ah', '5d', '9c'])
    expect(table.detail.dealer).toEqual(['Ah'])
    expect(table.detail.peeked).toBe(true)
    expect(table.hole).toBe('9c')
    expect(JSON.stringify(table.detail)).not.toContain('9c')
    expect(table.detail.active).toBe(0)
  })

  it('ends the hand at once on a dealer blackjack, taking only the bet', () => {
    const table = run(['9s', 'Kh', '5d', 'Ac'])
    expect(isOver(table)).toBe(true)
    expect(table.detail.dealer).toEqual(['Kh', 'Ac'])
    expect(hand(table)).toMatchObject({ result: 'lose', payout: 0, done: true })
    expect(summarize(table.detail)).toBe('Dealer blackjack')
    expect(legalMoves(table.detail)).toEqual([])
    expect(whyNot(table.detail, 'hit')).toBe('This hand is over. Deal the next one.')
  })

  it('pushes a blackjack against a dealer blackjack', () => {
    const table = run(['As', 'Ah', 'Kd', 'Tc'])
    expect(hand(table)).toMatchObject({ result: 'push', payout: 1_000 })
    expect(summarize(table.detail)).toBe('Push, both blackjack')
  })

  it('pays a blackjack 3 to 2 at once, turning the hole card over without drawing more', () => {
    const table = run(['As', '6h', 'Kd', 'Tc'])
    expect(isOver(table)).toBe(true)
    expect(table.detail.dealer).toEqual(['6h', 'Tc'])
    expect(hand(table)).toMatchObject({ result: 'blackjack', payout: 2_500 })
    expect(summarize(table.detail)).toBe('Blackjack')
  })

  it('pays a blackjack 3 to 2 after the dealer peeks and has none', () => {
    const table = run(['Ks', 'Ah', 'Ad', '7c'])
    expect(table.detail.dealer).toEqual(['Ah', '7c'])
    expect(hand(table)).toMatchObject({ result: 'blackjack', payout: 2_500 })
  })
})

describe('hit and stand', () => {
  it('hits until the player stands, then the dealer draws to 17', () => {
    // Player 5 3, hits a 4: 12, stands. Dealer 9, turns a 7: 16, draws a 5: 21.
    const table = run(['5s', '9h', '3d', '4c', '7c', '5h'], ['hit', 'stand'])
    expect(hand(table).cards).toEqual(['5s', '3d', '4c'])
    expect(table.detail.dealer).toEqual(['9h', '7c', '5h'])
    expect(hand(table).result).toBe('lose')
    expect(table.detail.moves).toEqual([
      { hand: 0, move: 'hit' },
      { hand: 0, move: 'stand' },
    ])
  })

  it('stands the dealer on a soft 17', () => {
    const table = run(['Ts', '6h', '8d', 'Ac'], ['stand'])
    expect(table.detail.dealer).toEqual(['6h', 'Ac'])
    expect(hand(table)).toMatchObject({ result: 'win', payout: 2_000 })
    expect(summarize(table.detail)).toBe('18 beats 17')
  })

  it('busts a hand over 21, and the dealer draws nothing more', () => {
    const table = run(['Ts', '6h', '6d', 'Kc', '9c'], ['hit'])
    expect(hand(table)).toMatchObject({ result: 'bust', payout: 0, cards: ['Ts', '6d', 'Kc'] })
    expect(table.detail.dealer).toEqual(['6h', '9c'])
    expect(summarize(table.detail)).toBe('Bust on 26')
  })

  it('stands a hand by itself when it reaches 21', () => {
    const table = run(['5s', '9h', '6d', 'Kc', '5c', '4h'], ['hit'])
    expect(hand(table).cards).toEqual(['5s', '6d', 'Kc'])
    expect(table.detail.dealer).toEqual(['9h', '5c', '4h'])
    expect(hand(table)).toMatchObject({ result: 'win', payout: 2_000 })
  })

  it('pays a dealer bust', () => {
    const table = run(['Ts', '6h', '2d', 'Tc', '8c'], ['stand'])
    expect(table.detail.dealer).toEqual(['6h', 'Tc', '8c'])
    expect(hand(table)).toMatchObject({ result: 'win', payout: 2_000 })
    expect(summarize(table.detail)).toBe('Dealer bust on 24')
  })

  it('returns the stake on a push', () => {
    const table = run(['Ts', '9h', '9d', 'Tc'], ['stand'])
    expect(hand(table)).toMatchObject({ result: 'push', payout: 1_000 })
    expect(summarize(table.detail)).toBe('Push on 19')
  })

  it('takes the stake when the dealer is higher', () => {
    const table = run(['Ts', '9h', '7d', 'Tc'], ['stand'])
    expect(hand(table)).toMatchObject({ result: 'lose', payout: 0 })
    expect(summarize(table.detail)).toBe('19 beats 17')
  })
})

describe('double', () => {
  it('doubles the stake for exactly one card, on any two cards', () => {
    const table = run(['9s', '6h', '6d', '2c', 'Tc', 'Kh'], ['double'])
    // Player 9 6 = 15 doubles, gets a 2: 17. Dealer 6 T = 16, draws K: bust.
    expect(hand(table)).toMatchObject({
      cards: ['9s', '6d', '2c'],
      doubled: true,
      stake: 2_000,
      result: 'win',
      payout: 4_000,
    })
    expect(summarize(table.detail)).toBe('Doubled, dealer bust on 26')
  })

  it('loses twice the bet on a lost double', () => {
    // 6 5 = 11 doubles and gets a 2: 13. Dealer 9 T = 19.
    const table = run(['6s', '9h', '5d', '2c', 'Tc'], ['double'])
    expect(hand(table)).toMatchObject({ stake: 2_000, result: 'lose', payout: 0 })
    expect(roundPayout(table.detail)).toBe(0n)
  })

  it('is open only on the first two cards', () => {
    const table = run(['2s', '9h', '3d', '4c'], ['hit'])
    expect(legalMoves(table.detail)).toEqual(['hit', 'stand'])
    expect(whyNot(table.detail, 'double')).toBe('You can only double on your first two cards.')
    expect(() => commit(table, 'double')).toThrow()
  })
})

describe('split', () => {
  it('makes two hands of one card each, dealing the second hand its card only when its turn comes', () => {
    const deck = stack('8s', '6h', '8d', '3c')
    const table = deal(BET, deck)
    expect(legalMoves(table.detail)).toEqual(['hit', 'stand', 'double', 'split'])
    play(table, 'split', deck)
    expect(table.detail.hands.map((h) => h.cards)).toEqual([['8s', '3c'], ['8d']])
    expect(table.detail.hands.map((h) => h.stake)).toEqual([1_000, 1_000])
    expect(table.detail.active).toBe(0)
    expect(deck.left()).toBe(0)
  })

  it('plays both hands, then the dealer, and settles each on its own', () => {
    // 8 8 against a 6. Hand 1: 8 3 = 11, doubles (double after split), gets a T: 21.
    // Hand 2: 8 K = 18, stands. Dealer 6 9 = 15, draws 5 = 20.
    const table = run(
      ['8s', '6h', '8d', '3c', 'Td', 'Kh', '9c', '5s'],
      ['split', 'double', 'stand'],
    )
    expect(table.detail.hands).toMatchObject([
      { cards: ['8s', '3c', 'Td'], doubled: true, stake: 2_000, result: 'win', payout: 4_000 },
      { cards: ['8d', 'Kh'], doubled: false, stake: 1_000, result: 'lose', payout: 0 },
    ])
    expect(table.detail.dealer).toEqual(['6h', '9c', '5s'])
    expect(roundPayout(table.detail)).toBe(4_000n)
    expect(summarize(table.detail)).toBe('Split: won 21 doubled, lost 18')
  })

  it('splits only once', () => {
    const table = run(['8s', '6h', '8d', '8c'], ['split'])
    expect(table.detail.hands[0]?.cards).toEqual(['8s', '8c'])
    expect(legalMoves(table.detail)).toEqual(['hit', 'stand', 'double'])
    expect(whyNot(table.detail, 'split')).toBe('You can split once per hand.')
  })

  it('gives split aces one card each, and an ace and a ten there is 21, not blackjack', () => {
    const table = run(['As', '9h', 'Ad', 'Kc', '5d', '8h'], ['split'])
    expect(table.detail.hands).toMatchObject([
      { cards: ['As', 'Kc'], result: 'win', payout: 2_000 },
      { cards: ['Ad', '5d'], result: 'lose', payout: 0 },
    ])
    expect(table.detail.dealer).toEqual(['9h', '8h'])
  })

  it('splits two different ten-value cards', () => {
    const table = run(['Ks', '7h', 'Qd', '9c', '8s', 'Tc'], ['split', 'stand', 'stand'])
    expect(table.detail.hands.map((h) => h.cards)).toEqual([
      ['Ks', '9c'],
      ['Qd', '8s'],
    ])
    expect(table.detail.hands.map((h) => h.result)).toEqual(['win', 'win'])
  })

  it('still plays the dealer when only one split hand busted', () => {
    const table = run(['9s', '7h', '9d', '5c', 'Kc', 'Td', 'Th'], ['split', 'hit', 'stand'])
    // Hand 1: 9 5 K = 24, bust. Hand 2: 9 T = 19, stands. Dealer 7 T = 17.
    expect(table.detail.hands.map((h) => h.result)).toEqual(['bust', 'win'])
    expect(table.detail.dealer).toEqual(['7h', 'Th'])
  })

  it('lets the second hand reach 21 by itself', () => {
    const table = run(['Ts', '7h', 'Td', '8c', 'Ah', 'Kc'], ['split', 'stand'])
    expect(table.detail.hands.map((h) => h.cards)).toEqual([
      ['Ts', '8c'],
      ['Td', 'Ah'],
    ])
    expect(table.detail.hands.map((h) => h.result)).toEqual(['win', 'win'])
  })
})

describe('the stake a move adds', () => {
  it('asks for one more bet to double or split, and nothing to hit or stand', () => {
    const table = run(['8s', '6h', '8d'])
    expect(extraStake(table.detail, 'double')).toBe(1_000)
    expect(extraStake(table.detail, 'split')).toBe(1_000)
    expect(extraStake(table.detail, 'hit')).toBe(0)
    expect(extraStake(table.detail, 'stand')).toBe(0)
  })
})

describe('the idle rule', () => {
  it('stands a hand left in play', () => {
    const table = run(['Ts', '9h', '6d'])
    standAll(table, stack('Tc'))
    expect(table.detail.dealer).toEqual(['9h', 'Tc'])
    expect(hand(table)).toMatchObject({ cards: ['Ts', '6d'], result: 'lose', payout: 0 })
    expect(summarize(table.detail)).toBe('19 beats 16 (stood for an idle hand)')
  })

  it('leaves a finished hand as it was', () => {
    const table = run(['9s', 'Kh', '5d', 'Ac'])
    const before = structuredClone(table.detail)
    standAll(table, stack())
    expect(table.detail).toEqual(before)
  })

  it('stands every hand still in play and plays the dealer out', () => {
    const deck = stack('8s', '6h', '8d', '3c', 'Tc', 'Ah')
    const table = deal(BET, deck)
    play(table, 'split', deck)
    standAll(table, deck)
    // Hand 1 stood on 11; hand 2 got the card it was owed (T) and stood on 18.
    expect(table.detail.hands.map((h) => h.cards)).toEqual([
      ['8s', '3c'],
      ['8d', 'Tc'],
    ])
    expect(table.detail.dealer).toEqual(['6h', 'Ah'])
    expect(table.detail.idle).toBe(true)
    expect(isOver(table)).toBe(true)
    expect(summarize(table.detail)).toBe('Split: lost 11, won 18 (stood for an idle hand)')
  })
})

describe('payouts', () => {
  it('pays every outcome, rounded down to a hundredth', () => {
    expect(handPayout(1_000n, 'blackjack')).toBe(2_500n)
    expect(handPayout(1_000n, 'win')).toBe(2_000n)
    expect(handPayout(1_000n, 'push')).toBe(1_000n)
    expect(handPayout(1_000n, 'lose')).toBe(0n)
    expect(handPayout(1_000n, 'bust')).toBe(0n)
    // 1.01 chips: a blackjack pays 1.515 on top, paid as 1.51.
    expect(handPayout(101n, 'blackjack')).toBe(252n)
    expect(handPayout(1n, 'blackjack')).toBe(2n)
  })
})

describe('the slow reveal', () => {
  it('starts on a big bet: all in, or over the share of the wallet', () => {
    expect(isSlowRevealBet(1_000n, 0n, true, 5_000)).toBe(true)
    expect(isSlowRevealBet(5_001n, 4_999n, false, 5_000)).toBe(true)
    expect(isSlowRevealBet(5_000n, 5_000n, false, 5_000)).toBe(false)
    expect(isSlowRevealBet(1_000n, 9_000n, false, 5_000)).toBe(false)
    expect(isSlowRevealBet(2_000n, 8_000n, false, 1_000)).toBe(true)
  })

  it('plays for a hit from a hard 12 or more, never from a soft hand or a small bet', () => {
    const detail = (cards: Card[], slowReveal = true): BlackjackDetail => ({
      ...undealt(),
      bet: 1_000,
      slowReveal,
      active: 0,
      dealer: ['9s'],
      hands: [{ cards, stake: 1_000, doubled: false, done: false, result: null, payout: null }],
    })
    const slow = (cards: Card[], big = true) => {
      const d = detail(cards, big)
      return slowHitFor(d, hand({ detail: d, hole: null }))
    }
    expect(slow(['Ts', '2d'])).toBe(true)
    expect(slow(['Ts', '6d'])).toBe(true)
    expect(slow(['As', '5d', '6c'])).toBe(true) // a hard 12 with an ace in it
    expect(slow(['Ts', 'Ad'])).toBe(false)
    expect(slow(['As', '6d'])).toBe(false) // soft 17 cannot bust
    expect(slow(['9s', '2d'])).toBe(false) // 11 cannot bust
    expect(slow(['Ts', '6d'], false)).toBe(false)
  })
})

describe('the shoe', () => {
  it('holds six decks and deals each card at most six times', () => {
    const shoe = new Shoe()
    expect(shoe.size).toBe(312)
    const counts = new Map<Card, number>()
    for (let i = 0; i < 312; i++) {
      const card = shoe.draw()
      counts.set(card, (counts.get(card) ?? 0) + 1)
    }
    expect(counts.size).toBe(52)
    expect([...counts.values()].every((n) => n === 6)).toBe(true)
    expect(() => shoe.draw()).toThrow('empty')
    shoe.reset()
    expect(shoe.size).toBe(312)
  })

  it('leaves out the cards already on the table', () => {
    const dealt: Card[] = ['As', 'As', 'As', 'As', 'As', 'As', 'Kd']
    const shoe = new Shoe(dealt)
    expect(shoe.size).toBe(305)
    const drawn: Card[] = []
    for (let i = 0; i < 305; i++) drawn.push(shoe.draw())
    expect(drawn).not.toContain('As')
    expect(drawn.filter((card) => card === 'Kd')).toHaveLength(5)
    expect(() => new Shoe([...dealt, 'As'])).toThrow('More than 6')
  })

  it('draws every card about equally often', () => {
    const shoe = new Shoe()
    const counts = new Map<Card, number>()
    const draws = 104_000
    for (let i = 0; i < draws; i++) {
      shoe.reset()
      const card = shoe.draw()
      counts.set(card, (counts.get(card) ?? 0) + 1)
    }
    // 2,000 expected for each card, with a standard deviation of about 44.
    for (const card of DECK) expect(Math.abs((counts.get(card) ?? 0) - 2_000)).toBeLessThan(260)
  })

  it('knows every card dealt, the hole card included', () => {
    const table = deal(BET, stack('9s', 'Ah', '5d', '9c'))
    expect(dealtCards(table).sort()).toEqual(['5d', '9c', '9s', 'Ah'].sort())
  })
})

describe('moves in two steps', () => {
  it('takes the stake before the card: commit draws nothing, drawFor draws', () => {
    const deck = stack('9s', '6h', '2d', 'Tc', 'Th', '5c')
    const table = deal(BET, deck)
    commit(table, 'double')
    expect(hand(table)).toMatchObject({ doubled: true, stake: 2_000, cards: ['9s', '2d'] })
    expect(deck.left()).toBe(3)
    drawFor(table, 'double', deck)
    expect(hand(table).cards).toEqual(['9s', '2d', 'Tc'])
    expect(isOver(table)).toBe(true)
  })
})

describe('the inputs', () => {
  it('takes a typed bet', () => {
    expect(BlackjackDealInput.parse({ bet: ' all ' })).toEqual({ bet: 'all' })
    expect(BlackjackDealInput.safeParse({ bet: '' }).error?.issues[0]?.message).toContain(
      'Type an amount',
    )
  })

  it('takes a move with the round and the step it was made on', () => {
    expect(BlackjackMoveInput.parse({ move: 'hit', roundId: 4, steps: 1 })).toEqual({
      move: 'hit',
      roundId: 4,
      steps: 1,
    })
    expect(
      BlackjackMoveInput.safeParse({ move: 'surrender', roundId: 4, steps: 1 }).error?.issues[0]
        ?.message,
    ).toBe('Pick hit, stand, double or split.')
  })

  it('refuses anything that tries to choose a card or a result', () => {
    expect(BlackjackDealInput.safeParse({ bet: '5', cards: ['As', 'Kd'] }).success).toBe(false)
    expect(
      BlackjackMoveInput.safeParse({ move: 'hit', roundId: 4, steps: 1, card: 'As' }).success,
    ).toBe(false)
  })
})
