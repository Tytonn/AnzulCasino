import { describe, expect, it } from 'vitest'

import { checkBetAmount, parseBetAmount } from '../../../shared/bet-amount.ts'
import {
  basisPoints,
  chipCount,
  chips,
  floorToChip,
  formatChips,
  formatChipsShort,
  fromWire,
  mulDiv,
} from '../../../shared/chips.ts'

describe('chips', () => {
  it('converts whole chips to hundredths', () => {
    expect(chips(100)).toBe(10_000n)
    expect(() => chips(1.5)).toThrow()
  })

  it('shows cents only when an amount is not whole', () => {
    expect(formatChips(10_700n)).toBe('107')
    expect(formatChips(10_750n)).toBe('107.50')
    expect(formatChips(10_705n)).toBe('107.05')
    expect(formatChips(123_456_789n)).toBe('1,234,567.89')
    expect(formatChips(0n)).toBe('0')
    expect(formatChips(-250n)).toBe('-2.50')
    expect(formatChips(500n, { sign: true })).toBe('+5')
    expect(formatChips(10_750)).toBe('107.50')
  })

  it('says chip or chips in sentences', () => {
    expect(chipCount(100n)).toBe('1 chip')
    expect(chipCount(0n)).toBe('0 chips')
    expect(chipCount(150n)).toBe('1.50 chips')
    expect(chipCount(200)).toBe('2 chips')
  })

  it('has a short form that never rounds up', () => {
    expect(formatChipsShort(95_000n)).toBe('950')
    expect(formatChipsShort(chips(12_500))).toBe('12.5K')
    expect(formatChipsShort(chips(1_999_999))).toBe('1.99M')
    expect(formatChipsShort(chips(10_000_000))).toBe('10M')
  })

  it('rounds payouts down to a whole hundredth', () => {
    expect(mulDiv(101n, 3n, 2n)).toBe(151n) // 151.5 -> 151
    expect(mulDiv(-101n, 3n, 2n)).toBe(-152n) // down, not toward zero
    expect(basisPoints(10_000n, 150n)).toBe(150n) // 1.5% of 100 chips
    expect(basisPoints(333n, 150n)).toBe(4n) // 4.995 -> 4
    expect(floorToChip(10_799n)).toBe(10_700n)
  })

  it('refuses wire amounts that are not safe integers', () => {
    expect(fromWire(150)).toBe(150n)
    expect(() => fromWire(1.5)).toThrow()
    expect(() => fromWire(2 ** 60)).toThrow()
  })
})

describe('typed bet amounts', () => {
  const wallet = chips(1_000) + 50n // 1,000.50

  it.each([
    ['250', chips(250)],
    ['12.5', 1_250n],
    ['12.50', 1_250n],
    ['12.999', 1_299n],
    ['.5', 50n],
    ['1,000', chips(1_000)],
    ['5k', chips(5_000)],
    ['2.5k', chips(2_500)],
    ['2.5K', chips(2_500)],
    [' 1.25m ', chips(1_250_000)],
    ['1b', chips(1_000_000_000)],
  ])('reads %s', (text, amount) => {
    expect(parseBetAmount(text, wallet)).toEqual({ ok: true, amount, keyword: null })
  })

  it('resolves all and half against the wallet', () => {
    expect(parseBetAmount('all', wallet)).toEqual({ ok: true, amount: wallet, keyword: 'all' })
    expect(parseBetAmount('MAX', wallet)).toEqual({ ok: true, amount: wallet, keyword: 'all' })
    expect(parseBetAmount('half', 101n)).toEqual({ ok: true, amount: 50n, keyword: 'half' })
  })

  it.each(['', 'abc', '5kk', '1e5', '-5', '5 k 3', '1.2.3', 'k'])('rejects %j', (text) => {
    const result = parseBetAmount(text, wallet)
    expect(result.ok).toBe(false)
  })

  it('checks limits in plain words', () => {
    const limits = { minBet: chips(1), maxBetPct: 100 }
    expect(checkBetAmount(chips(5), chips(10), limits)).toBeNull()
    expect(checkBetAmount(chips(10), chips(10), limits)).toBeNull()
    expect(checkBetAmount(50n, chips(10), limits)).toBe('The smallest bet is 1.')
    expect(checkBetAmount(chips(11), chips(10), limits)).toBe('You only have 10 chips.')
    expect(checkBetAmount(0n, 0n, limits)).toBe('Your wallet is empty.')
    expect(checkBetAmount(chips(6), chips(10), { minBet: chips(1), maxBetPct: 50 })).toMatch(
      /largest bet right now is 5/,
    )
  })
})
