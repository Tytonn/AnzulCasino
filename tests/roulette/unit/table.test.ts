/**
 * Roulette's table (spec: Games > Roulette): the 157 places to bet, what each
 * pays, the round's bets, and the house edge. The return to player is checked
 * exactly for every spot, then by a million real draws (spec: Quality bar).
 */
import { describe, expect, it } from 'vitest'

import {
  addBets,
  betsTotal,
  covers,
  numberName,
  paysTo,
  pocketColor,
  POCKETS,
  removeBet,
  settleBets,
  type SpotKind,
  SPOTS,
  spotById,
  spotReturn,
  WHEEL_ORDER,
} from '../../../shared/games/roulette.ts'
import { drawNumber } from '../../../server/games/roulette/rules.ts'

const kindCounts = (kind: SpotKind) => SPOTS.filter((s) => s.kind === kind).length

describe('the wheel', () => {
  it('is European: 0 to 36 once each, with a single green zero', () => {
    expect(POCKETS).toBe(37)
    expect(WHEEL_ORDER).toHaveLength(37)
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i))
    expect(pocketColor(0)).toBe('green')
    expect(WHEEL_ORDER.filter((n) => pocketColor(n) === 'red')).toHaveLength(18)
    expect(WHEEL_ORDER.filter((n) => pocketColor(n) === 'black')).toHaveLength(18)
  })

  it('alternates red and black around the wheel after zero', () => {
    for (let i = 1; i < WHEEL_ORDER.length - 1; i++) {
      const here = pocketColor(WHEEL_ORDER[i] as number)
      const next = pocketColor(WHEEL_ORDER[i + 1] as number)
      expect(here).not.toBe(next)
    }
  })

  it('names a number with its color', () => {
    expect(numberName(17)).toBe('17 Black')
    expect(numberName(32)).toBe('32 Red')
    expect(numberName(0)).toBe('0 Green')
  })
})

describe('the table', () => {
  it('has every place to bet once: 157 in all', () => {
    expect(SPOTS).toHaveLength(157)
    expect(new Set(SPOTS.map((s) => s.id)).size).toBe(157)
    expect(kindCounts('straight')).toBe(37)
    expect(kindCounts('split')).toBe(60)
    expect(kindCounts('street')).toBe(14)
    expect(kindCounts('corner')).toBe(23)
    expect(kindCounts('line')).toBe(11)
    expect(kindCounts('dozen')).toBe(3)
    expect(kindCounts('column')).toBe(3)
    for (const even of ['red', 'black', 'odd', 'even', 'low', 'high'] as const) {
      expect(kindCounts(even)).toBe(1)
    }
  })

  it('only joins numbers that touch on the layout', () => {
    // Column (0, 1, 2) and row (0..11) of a number on the felt; zero spans the left end.
    const at = (n: number) => ({ col: (n - 1) % 3, row: Math.floor((n - 1) / 3) })
    for (const spot of SPOTS) {
      if (spot.numbers.length > 6 || spot.numbers.includes(0)) continue
      const cells = spot.numbers.map(at)
      const rows = cells.map((c) => c.row)
      const cols = cells.map((c) => c.col)
      expect(Math.max(...rows) - Math.min(...rows), spot.id).toBeLessThanOrEqual(1)
      if (spot.kind === 'split' || spot.kind === 'corner') {
        expect(Math.max(...cols) - Math.min(...cols), spot.id).toBeLessThanOrEqual(1)
      }
      if (spot.kind === 'street') expect(new Set(rows).size, spot.id).toBe(1)
    }
    expect(spotById('0-1-2-3').name).toBe('First four')
    expect(spotById('0-2-3').name).toBe('Trio 0/2/3')
    expect(spotById('17-20').name).toBe('Split 17/20')
    expect(spotById('13-14-15-16-17-18').name).toBe('Line 13-18')
  })

  it('lays out the outside bets as on a real table', () => {
    expect(spotById('1st12').numbers).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(spotById('3rd12').numbers.at(-1)).toBe(36)
    expect(spotById('col1').numbers).toEqual([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34])
    expect(spotById('col3').numbers.at(-1)).toBe(36)
    expect(spotById('low').numbers).toHaveLength(18)
    expect(spotById('high').numbers[0]).toBe(19)
    expect(spotById('red').numbers).toContain(1)
    expect(spotById('black').numbers).toContain(2)
    for (const id of ['1st12', 'col2', 'red', 'black', 'odd', 'even', 'low', 'high']) {
      expect(covers(spotById(id), 0), `${id} loses on zero`).toBe(false)
    }
  })

  it('pays the spec: 35, 17, 11, 8, 5, 2 and 1 to 1', () => {
    const pays: Record<SpotKind, number> = {
      straight: 35,
      split: 17,
      street: 11,
      corner: 8,
      line: 5,
      dozen: 2,
      column: 2,
      red: 1,
      black: 1,
      odd: 1,
      even: 1,
      low: 1,
      high: 1,
    }
    for (const spot of SPOTS) expect(paysTo(spot), spot.id).toBe(pays[spot.kind])
  })

  it('returns the stake and the winnings on a win, and nothing on a loss', () => {
    expect(spotReturn(spotById('17'), 1_000n, 17)).toBe(36_000n)
    expect(spotReturn(spotById('17'), 1_000n, 18)).toBe(0n)
    expect(spotReturn(spotById('17-20'), 1_000n, 20)).toBe(18_000n)
    expect(spotReturn(spotById('0-1-2'), 1_000n, 0)).toBe(12_000n)
    expect(spotReturn(spotById('0-1-2-3'), 1_000n, 3)).toBe(9_000n)
    expect(spotReturn(spotById('1-2-3-4-5-6'), 1_000n, 6)).toBe(6_000n)
    expect(spotReturn(spotById('2nd12'), 1_000n, 13)).toBe(3_000n)
    expect(spotReturn(spotById('col3'), 1_000n, 36)).toBe(3_000n)
    expect(spotReturn(spotById('red'), 1_000n, 32)).toBe(2_000n)
    expect(spotReturn(spotById('red'), 1_000n, 0)).toBe(0n)
    // A single hundredth still pays exactly: 36 divides by every spot's size.
    for (const spot of SPOTS) {
      const win = spot.numbers[0] as number
      expect(spotReturn(spot, 1n, win) * BigInt(spot.numbers.length)).toBe(36n)
    }
  })
})

describe('the house edge', () => {
  it('returns exactly 36/37 of every bet, on every spot: a 2.7% edge', () => {
    const stake = 1_00n
    for (const spot of SPOTS) {
      let back = 0n
      for (let n = 0; n < POCKETS; n++) back += spotReturn(spot, stake, n)
      // Over the 37 equally likely numbers, the bet returns 36 stakes.
      expect(back, spot.id).toBe(36n * stake)
    }
  })

  it('draws every number equally often, and returns 36/37 over a million real spins', () => {
    const spins = 1_000_000
    const counts = new Array<number>(POCKETS).fill(0)
    let outside = 0
    for (let i = 0; i < spins; i++) {
      const n = drawNumber()
      if (Number.isInteger(n) && n >= 0 && n < POCKETS) counts[n] = (counts[n] as number) + 1
      else outside++
    }
    expect(outside).toBe(0)

    // Uniform: a chi-square test with 36 degrees of freedom. An honest wheel
    // stays under 100 all but once in ten million runs.
    const expected = spins / POCKETS
    const chi = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0)
    expect(chi).toBeLessThan(100)

    // One chip a spin on a single number, a six line and red: each returns
    // 36/37, within six standard errors.
    for (const [id, k] of [
      ['17', 1],
      ['13-14-15-16-17-18', 6],
      ['red', 18],
    ] as const) {
      const spot = spotById(id)
      const back = counts.reduce((sum, c, n) => sum + BigInt(c) * spotReturn(spot, 100n, n), 0n)
      const rtp = Number(back) / (spins * 100)
      const p = k / POCKETS
      const stdErr = ((36 / k) * Math.sqrt(p * (1 - p))) / Math.sqrt(spins)
      expect(Math.abs(rtp - 36 / 37), id).toBeLessThan(6 * stdErr)
    }
  })
})

describe('a round of bets', () => {
  it('stacks chips on a spot already bet, and adds new spots at the end', () => {
    let bets = addBets([], [{ spot: 'red', amount: 500n }])
    bets = addBets(bets, [
      { spot: '17', amount: 100n },
      { spot: 'red', amount: 250n },
    ])
    expect(bets).toEqual([
      { spot: 'red', amount: 750 },
      { spot: '17', amount: 100 },
    ])
    expect(betsTotal(bets)).toBe(850n)
  })

  it('takes chips off one spot, and the spot goes when it is empty', () => {
    const bets = [
      { spot: 'red', amount: 750 },
      { spot: '17', amount: 100 },
    ]
    expect(removeBet(bets, 'red', 250n)).toEqual([
      { spot: 'red', amount: 500 },
      { spot: '17', amount: 100 },
    ])
    expect(removeBet(bets, 'red', 750n)).toEqual([{ spot: '17', amount: 100 }])
    expect(removeBet(bets, '17', 1_000n)).toEqual([{ spot: 'red', amount: 750 }])
    // The input is left as it was.
    expect(bets[0]?.amount).toBe(750)
  })

  it('pays every winning bet in the round and names the spots that won', () => {
    const bets = [
      { spot: 'red', amount: 1_000 },
      { spot: '19', amount: 100 },
      { spot: '19-20-21', amount: 300 },
      { spot: 'odd', amount: 200 },
      { spot: '2nd12', amount: 500 },
    ]
    // 19 is red, odd, in the 2nd dozen and in the 19-21 street.
    const won = settleBets(bets, 19)
    expect(won.wins).toEqual(['red', '19', '19-20-21', 'odd', '2nd12'])
    expect(won.payout).toBe(2_000n + 3_600n + 3_600n + 400n + 1_500n)
    // 20 is black and even: only the street and the dozen win.
    expect(settleBets(bets, 20)).toEqual({ payout: 3_600n + 1_500n, wins: ['19-20-21', '2nd12'] })
    // 0 beats them all.
    expect(settleBets(bets, 0)).toEqual({ payout: 0n, wins: [] })
  })
})
