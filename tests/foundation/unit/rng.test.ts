import { describe, expect, it } from 'vitest'

import {
  chance,
  normalizeCode,
  pick,
  pickWeighted,
  randomBelow,
  randomCode,
  randomInt,
  randomUnit,
  shuffle,
} from '../../../server/lib/rng.ts'

/** Draws `n` times and counts each result. */
function tally<T>(n: number, draw: () => T): Map<T, number> {
  const counts = new Map<T, number>()
  for (let i = 0; i < n; i++) {
    const value = draw()
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

describe('server randomness', () => {
  it('draws integers inside the range, reaching both ends', () => {
    const seen = tally(4_000, () => randomInt(3, 7))
    expect([...seen.keys()].sort()).toEqual([3, 4, 5, 6])
    const below = tally(2_000, () => randomBelow(2))
    expect([...below.keys()].sort()).toEqual([0, 1])
  })

  it('decides chance by its exact odds', () => {
    expect(chance(0, 10)).toBe(false)
    expect(chance(10, 10)).toBe(true)
    const wins = tally(40_000, () => chance(1, 4)).get(true) ?? 0
    // 10,000 expected; 5 standard deviations is about 433.
    expect(Math.abs(wins - 10_000)).toBeLessThan(450)
    expect(() => chance(0.5, 2)).toThrow()
    expect(() => chance(1, 0)).toThrow()
  })

  it('picks every item, and refuses an empty list', () => {
    expect(new Set(Array.from({ length: 500 }, () => pick(['a', 'b', 'c'])))).toEqual(
      new Set(['a', 'b', 'c']),
    )
    expect(() => pick([])).toThrow()
  })

  it('picks by weight, never drawing a weight of 0', () => {
    const counts = tally(60_000, () =>
      pickWeighted([
        ['cherry', 30],
        ['never', 0],
        ['bell', 9],
        ['seven', 1],
      ] as const),
    )
    expect(counts.has('never')).toBe(false)
    // Expected 45,000 / 13,500 / 1,500, each within 5 standard deviations.
    expect(Math.abs((counts.get('cherry') ?? 0) - 45_000)).toBeLessThan(560)
    expect(Math.abs((counts.get('bell') ?? 0) - 13_500)).toBeLessThan(500)
    expect(Math.abs((counts.get('seven') ?? 0) - 1_500)).toBeLessThan(200)
  })

  it('refuses weights that are not whole, negative, or all zero', () => {
    expect(() => pickWeighted([['a', 1.5]])).toThrow()
    expect(() => pickWeighted([['a', -1]])).toThrow()
    expect(() => pickWeighted([['a', 0]])).toThrow()
    expect(() => pickWeighted([])).toThrow()
    expect(pickWeighted([['only', 1]])).toBe('only')
  })

  it('shuffles into a permutation and leaves the input alone', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8]
    const shuffled = shuffle(items)
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items)
    // Every position takes every value sometimes.
    const firsts = tally(2_000, () => shuffle(items)[0])
    expect(firsts.size).toBe(8)
  })

  it('draws units in [0, 1)', () => {
    for (let i = 0; i < 2_000; i++) {
      const u = randomUnit()
      expect(u).toBeGreaterThanOrEqual(0)
      expect(u).toBeLessThan(1)
    }
  })

  it('makes readable codes and reads them back however they are typed', () => {
    const code = randomCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(normalizeCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code)
    expect(normalizeCode('o1il-abcd')).toBe('0111-ABCD')
  })
})
