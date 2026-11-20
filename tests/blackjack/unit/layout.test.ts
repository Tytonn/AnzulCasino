/**
 * Where everything sits on the felt (src/games/blackjack/layout.ts): the
 * cards take the largest size that fits, the rows never overlap, and a split
 * keeps its two hands apart.
 */
import { describe, expect, it } from 'vitest'

import {
  handCenters,
  handSpan,
  MAX_CARD,
  tableLayout,
} from '../../../src/games/blackjack/layout.ts'

describe('the table layout', () => {
  const sizes = [
    [325, 174],
    [340, 207],
    [325, 151],
    [724, 200],
    [724, 233],
    [798, 326],
    [798, 357],
    [1100, 540],
  ] as const

  it('fits both rows and the space between them into the seat', () => {
    for (const [width, height] of sizes) {
      const layout = tableLayout(width, height)
      expect(layout.height, `${width}x${height}`).toBe(Math.max(height, layout.minHeight))
      expect(layout.bandTop).toBe(layout.dealerTop + layout.cardHeight)
      expect(layout.playerTop).toBe(layout.bandTop + layout.band)
      expect(layout.playerTop + layout.cardHeight).toBeLessThanOrEqual(layout.height)
      expect(layout.dealerTop).toBeGreaterThanOrEqual(0)
    }
  })

  it('makes the cards as large as the height allows, up to the largest size', () => {
    expect(tableLayout(798, 357).card).toBe(MAX_CARD)
    expect(tableLayout(724, 233).card).toBeLessThan(tableLayout(724, 300).card)
    expect(tableLayout(1600, 2000).card).toBe(MAX_CARD)
  })

  it('never shrinks the cards past a readable size: the page scrolls instead', () => {
    const phone = tableLayout(325, 80)
    expect(phone.compact).toBe(true)
    expect(phone.card).toBe(36)
    expect(phone.height).toBe(phone.minHeight)
    const laptop = tableLayout(724, 80)
    expect(laptop.compact).toBe(false)
    expect(laptop.card).toBe(44)
  })

  it('keeps the shoe inside the table, at the dealer row', () => {
    for (const [width, height] of sizes) {
      const layout = tableLayout(width, height)
      expect(layout.shoe.x + layout.shoe.card / 2).toBeLessThan(width / 2)
      expect(layout.shoe.y).toBe(layout.dealerTop + Math.round(layout.cardHeight / 2))
    }
  })

  it('sizes a History replay by its cards', () => {
    const replay = tableLayout(560, null, 52)
    expect(replay.card).toBe(52)
    expect(replay.height).toBe(replay.minHeight - 2 * Math.round(44 * 1.4) + 2 * replay.cardHeight)
  })
})

describe('hands side by side', () => {
  it('centers one hand and spreads a split apart without the hands touching', () => {
    expect(handCenters([handSpan(3, 60)], 60)).toEqual([0])
    for (const count of [2, 3, 4, 5, 6]) {
      const span = handSpan(count, 60)
      const [left = 0, right = 0] = handCenters([span, span], 60)
      expect(left).toBe(-right)
      expect(right - left).toBeGreaterThan(span)
    }
  })
})
