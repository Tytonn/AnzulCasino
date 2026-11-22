import { describe, expect, it } from 'vitest'

import { checkBetAmount, maxBet, parseBetAmount } from '../../../shared/bet-amount.ts'
import {
  basisPoints,
  chipCount,
  CHIP,
  chips,
  formatChips,
  formatChipsShort,
  formatMultiplier,
  formatShare,
  fromWire,
  mulDiv,
} from '../../../shared/chips.ts'

describe('chips', () => {
  it('counts whole chips, refusing fractions', () => {
    expect(CHIP).toBe(1n)
    expect(chips(100)).toBe(100n)
    expect(chips(0)).toBe(0n)
    expect(() => chips(1.5)).toThrow()
    expect(() => chips(0.01)).toThrow()
  })

  it('shows whole chips with thousands separators and no decimals', () => {
    expect(formatChips(107n)).toBe('107')
    expect(formatChips(1_234_567n)).toBe('1,234,567')
    expect(formatChips(0n)).toBe('0')
    expect(formatChips(-250n)).toBe('-250')
    expect(formatChips(5n, { sign: true })).toBe('+5')
    expect(formatChips(-5n, { sign: true })).toBe('-5')
    expect(formatChips(0n, { sign: true })).toBe('0')
    expect(formatChips(10_750)).toBe('10,750')
    // A wire number is whole; anything after a point is dropped, never shown.
    expect(formatChips(107.9)).toBe('107')
  })

  it('says chip or chips in sentences', () => {
    expect(chipCount(1n)).toBe('1 chip')
    expect(chipCount(0n)).toBe('0 chips')
    expect(chipCount(150n)).toBe('150 chips')
    expect(chipCount(2)).toBe('2 chips')
  })

  it('has a short form that never rounds up', () => {
    expect(formatChipsShort(950n)).toBe('950')
    expect(formatChipsShort(chips(12_500))).toBe('12.5K')
    expect(formatChipsShort(chips(1_999_999))).toBe('1.99M')
    expect(formatChipsShort(chips(10_000_000))).toBe('10M')
    expect(formatChipsShort(-1_500)).toBe('-1.5K')
  })

  it('rounds payouts, steals and fines down to a whole chip', () => {
    expect(mulDiv(101n, 3n, 2n)).toBe(151n) // 151.5 -> 151
    expect(mulDiv(-101n, 3n, 2n)).toBe(-152n) // down, not toward zero
    expect(mulDiv(1n, 196n, 100n)).toBe(1n) // a 1-chip win at 1.96x pays 1
    expect(basisPoints(100n, 150n)).toBe(1n) // 1.5% of 100 chips: 1.5 -> 1
    expect(basisPoints(333n, 150n)).toBe(4n) // 4.995 -> 4
    expect(basisPoints(66n, 150n)).toBe(0n) // 0.99 -> 0
    expect(basisPoints(10_000n, 30)).toBe(30n) // config values are numbers
    expect(() => basisPoints(10_000n, 1.5)).toThrow()
  })

  it('shows basis points as percentages', () => {
    expect(formatShare(10_000)).toBe('100%')
    expect(formatShare(5_500)).toBe('55%')
    expect(formatShare(150)).toBe('1.5%')
    expect(formatShare(30)).toBe('0.3%')
    expect(formatShare(5)).toBe('0.05%')
  })

  it('refuses wire amounts that are not safe integers', () => {
    expect(fromWire(150)).toBe(150n)
    expect(() => fromWire(1.5)).toThrow()
    expect(() => fromWire(2 ** 60)).toThrow()
  })
})

describe('multipliers', () => {
  it('shows hundredths without trailing zeros, rounded down', () => {
    expect(formatMultiplier(200)).toBe('2x')
    expect(formatMultiplier(196)).toBe('1.96x')
    expect(formatMultiplier(1_050)).toBe('10.5x')
    expect(formatMultiplier(100_000)).toBe('1,000x')
    expect(formatMultiplier(0)).toBe('0x')
    expect(formatMultiplier(-5)).toBe('0x')
    expect(formatMultiplier(123.9)).toBe('1.23x')
  })
})

describe('typed bet amounts', () => {
  const wallet = chips(1_001)

  it.each([
    ['250', chips(250)],
    // Chips are whole: anything finer rounds down.
    ['12.5', 12n],
    ['12.50', 12n],
    ['12.999', 12n],
    ['.5', 0n],
    ['1,000', chips(1_000)],
    ['5k', chips(5_000)],
    ['2.5k', chips(2_500)],
    ['2.5K', chips(2_500)],
    [' 1.25m ', chips(1_250_000)],
    ['1b', chips(1_000_000_000)],
    ['1.2345k', chips(1_234)],
  ])('reads %s', (text, amount) => {
    expect(parseBetAmount(text, wallet)).toEqual({ ok: true, amount, keyword: null })
  })

  it('resolves all and half against the wallet', () => {
    expect(parseBetAmount('all', wallet)).toEqual({ ok: true, amount: wallet, keyword: 'all' })
    expect(parseBetAmount('All-in', wallet)).toEqual({ ok: true, amount: wallet, keyword: 'all' })
    expect(parseBetAmount('half', 101n)).toEqual({ ok: true, amount: 50n, keyword: 'half' })
  })

  it('resolves max to the largest bet the limits allow', () => {
    expect(parseBetAmount('MAX', wallet)).toEqual({ ok: true, amount: wallet, keyword: 'max' })
    expect(parseBetAmount('max', wallet, { maxBetPct: 10_000 })).toMatchObject({ amount: wallet })
    expect(parseBetAmount('max', chips(10), { maxBetPct: 2_500 })).toMatchObject({
      amount: 2n,
    })
    expect(parseBetAmount('half', chips(7))).toMatchObject({ amount: 3n })
    expect(maxBet(0n, { maxBetPct: 10_000 })).toBe(0n)
    expect(maxBet(chips(10), { maxBetPct: 3_333 })).toBe(3n)
  })

  it.each(['', 'abc', '5kk', '1e5', '-5', '5 k 3', '1.2.3', 'k'])('rejects %j', (text) => {
    const result = parseBetAmount(text, wallet)
    expect(result.ok).toBe(false)
  })

  it('checks limits in plain words', () => {
    const limits = { minBet: chips(1), maxBetPct: 10_000 }
    expect(checkBetAmount(chips(5), chips(10), limits)).toBeNull()
    expect(checkBetAmount(chips(10), chips(10), limits)).toBeNull()
    // "0" and "0.5", which rounds down to nothing, get the same answer.
    expect(checkBetAmount(0n, chips(10), limits)).toBe('The smallest bet is 1.')
    expect(checkBetAmount(0n, chips(10), { minBet: 0n, maxBetPct: 10_000 })).toBe(
      'The smallest bet is 1.',
    )
    expect(checkBetAmount(chips(4), chips(10), { minBet: chips(5), maxBetPct: 10_000 })).toBe(
      'The smallest bet is 5.',
    )
    expect(checkBetAmount(chips(11), chips(10), limits)).toBe('You only have 10 chips.')
    expect(checkBetAmount(0n, 0n, limits)).toBe('Your wallet is empty.')
    expect(checkBetAmount(chips(6), chips(10), { minBet: chips(1), maxBetPct: 5_000 })).toBe(
      'The largest bet right now is 5 (50% of your wallet).',
    )
  })
})
