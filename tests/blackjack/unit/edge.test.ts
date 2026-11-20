/**
 * The house edge (spec: Games > Blackjack: "a simulation of basic strategy
 * over a few million hands that lands near the expected edge"). Each hand is
 * dealt from a fresh six-deck shoe drawn with node:crypto, exactly as the
 * game deals, and played by basic strategy for these rules.
 */
import { describe, expect, it } from 'vitest'

import { roundPayout } from '../../../shared/games/blackjack.ts'
import { Shoe } from '../../../server/games/blackjack/rules.ts'
import { playBasic } from './basic-strategy.ts'

/**
 * The edge for basic strategy under these rules, as a share of the first
 * bet: 0.461% over 40 million hands of this engine (standard error 0.018%),
 * which is the "about 0.5% with good play" the spec expects.
 */
const EXPECTED_EDGE = 0.0046
const HANDS = 4_000_000

describe('the house edge', () => {
  it(`is about ${(EXPECTED_EDGE * 100).toFixed(2)}% of the bet with basic strategy over ${HANDS / 1_000_000} million hands`, () => {
    const bet = 100n
    const shoe = new Shoe()
    let net = 0
    let netSquared = 0
    let staked = 0
    let paid = 0
    for (let i = 0; i < HANDS; i++) {
      shoe.reset()
      const table = playBasic(bet, shoe)
      const stake = table.detail.hands.reduce((sum, hand) => sum + hand.stake, 0)
      const payout = Number(roundPayout(table.detail))
      const result = (payout - stake) / Number(bet)
      net += result
      netSquared += result * result
      staked += stake
      paid += payout
    }
    const mean = net / HANDS
    const sd = Math.sqrt(netSquared / HANDS - mean * mean)
    const standardError = sd / Math.sqrt(HANDS)
    const edge = -mean

    // Splits and doubles make a hand swing by about 1.15 bets.
    expect(sd).toBeGreaterThan(1.1)
    expect(sd).toBeLessThan(1.2)
    // 4.5 standard errors: a fair engine fails this about once in 150,000 runs.
    expect(Math.abs(edge - EXPECTED_EDGE)).toBeLessThan(4.5 * standardError)
    // The house keeps a little under half a percent of everything staked.
    expect(paid / staked).toBeGreaterThan(0.99)
    expect(paid / staked).toBeLessThan(1)
  }, 120_000)
})
