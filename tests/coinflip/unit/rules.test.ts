/**
 * Coin flip's rules: the payout, the multiplier shown in the room, the input
 * the endpoint accepts, and the house edge (spec: Quality bar: "Where there
 * is a house edge, a test proves the return is within tolerance").
 */
import { describe, expect, it } from 'vitest'

import {
  CoinflipPlayInput,
  coinflipPayout,
  SIDES,
  winMultiplier,
} from '../../../shared/games/coinflip.ts'
import { flip } from '../../../server/games/coinflip/rules.ts'

describe('coin flip payouts', () => {
  it('pays twice the stake less the edge on a win, and nothing on a loss', () => {
    expect(coinflipPayout(10_000n, true, 200)).toBe(19_600n)
    expect(coinflipPayout(10_000n, false, 200)).toBe(0n)
    expect(coinflipPayout(10_000n, true, 0)).toBe(20_000n)
    expect(coinflipPayout(100n, true, 200)).toBe(196n)
  })

  it('rounds a payout down to a whole hundredth', () => {
    // 1.01 chips at 2%: 1.9796 chips, paid as 1.97.
    expect(coinflipPayout(101n, true, 200)).toBe(197n)
    expect(coinflipPayout(333n, true, 150)).toBe(656n)
  })

  it('shows the multiplier a win pays, rounded down', () => {
    expect(winMultiplier(200)).toBe(196)
    expect(winMultiplier(0)).toBe(200)
    expect(winMultiplier(125)).toBe(197)
  })

  it('returns exactly 100% less the edge on average', () => {
    for (const edge of [0, 100, 200, 500]) {
      const stake = 1_000_000n
      // Heads and tails are equally likely: the expected payout is the mean of the two.
      const expected = (coinflipPayout(stake, true, edge) + coinflipPayout(stake, false, edge)) / 2n
      expect(Number(expected) / Number(stake)).toBeCloseTo(1 - edge / 10_000, 10)
    }
  })

  it('returns 98% at a 2% edge over a million real flips, within half a percent', () => {
    const flips = 1_000_000
    const stake = 100n
    let paid = 0n
    let heads = 0
    for (let i = 0; i < flips; i++) {
      const face = flip()
      if (face === 'heads') heads++
      paid += coinflipPayout(stake, face === 'heads', 200)
    }
    const rtp = Number(paid) / (flips * Number(stake))
    // One flip's return has a standard deviation of 0.98; over a million
    // flips that is 0.00098, so half a percent is five standard deviations.
    expect(Math.abs(rtp - 0.98)).toBeLessThan(0.005)
    // The coin is fair: heads within five standard deviations of half.
    expect(Math.abs(heads - flips / 2)).toBeLessThan(2_500)
  }, 30_000)

  it('flips only heads or tails', () => {
    const seen = new Set(Array.from({ length: 200 }, () => flip()))
    expect([...seen].sort()).toEqual([...SIDES].sort())
  })
})

describe('the play input', () => {
  it('takes a typed bet and a call', () => {
    expect(CoinflipPlayInput.parse({ bet: ' 2.5k ', call: 'tails' })).toEqual({
      bet: '2.5k',
      call: 'tails',
    })
  })

  it.each([
    [{ bet: '10', call: 'edge' }, 'Call heads or tails.'],
    [{ bet: '', call: 'heads' }, 'Type an amount, like 50, 2.5k, half or all.'],
    [{ bet: '1'.repeat(40), call: 'heads' }, 'That bet is too long to read.'],
  ])('refuses %j in plain words', (input, message) => {
    const result = CoinflipPlayInput.safeParse(input)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain(message)
  })

  it('refuses anything else, such as an outcome', () => {
    expect(CoinflipPlayInput.safeParse({ bet: '10', call: 'heads', face: 'heads' }).success).toBe(
      false,
    )
    expect(CoinflipPlayInput.safeParse({ bet: 10, call: 'heads' }).success).toBe(false)
  })
})
