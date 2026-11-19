/**
 * The felt's two shapes (src/games/roulette/layout.ts): every place to bet
 * has a hit area in both, combinations never overlap each other, and each
 * sits on the line or corner it belongs to, inside the table.
 */
import { describe, expect, it } from 'vitest'

import { SPOTS, spotById } from '../../../shared/games/roulette.ts'
import {
  type Box,
  missingSpots,
  type Orientation,
  tableLayout,
} from '../../../src/games/roulette/layout.ts'

const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w - 0.001 &&
  b.x < a.x + a.w - 0.001 &&
  a.y < b.y + b.h - 0.001 &&
  b.y < a.y + a.h - 0.001

const contains = (outer: Box, x: number, y: number) =>
  x >= outer.x - 0.001 &&
  x <= outer.x + outer.w + 0.001 &&
  y >= outer.y - 0.001 &&
  y <= outer.y + outer.h + 0.001

describe.each<Orientation>(['wide', 'tall'])('the %s table', (orientation) => {
  const layout = tableLayout(orientation)

  it('has a place for every spot, and nothing else', () => {
    expect(missingSpots(layout)).toEqual([])
    expect(layout.spots.size).toBe(SPOTS.length)
  })

  it('keeps combinations apart, so every click means one bet', () => {
    const combos = [...layout.spots.values()].filter((s) => s.layer === 'combo')
    for (let i = 0; i < combos.length; i++) {
      for (let j = i + 1; j < combos.length; j++) {
        const a = combos[i]
        const b = combos[j]
        if (!a || !b) continue
        expect(overlap(a.hit, b.hit), `${a.id} and ${b.id}`).toBe(false)
      }
    }
  })

  it('puts each combination where its numbers meet', () => {
    for (const shape of layout.spots.values()) {
      expect(shape.hit.w).toBeGreaterThan(0)
      expect(shape.hit.h).toBeGreaterThan(0)
      expect(
        contains({ x: 0, y: 0, w: layout.width, h: layout.height }, shape.anchor.x, shape.anchor.y),
      ).toBe(true)
      if (shape.layer !== 'combo') continue
      const spot = spotById(shape.id)
      // The anchor touches (or sits within a few units of) every number it covers.
      for (const n of spot.numbers) {
        const box = layout.numberBoxes.get(n)
        if (!box) throw new Error(`no box for ${n}`)
        const near = { x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 }
        const outsideEdge = spot.kind === 'street' || spot.kind === 'line' || shape.id === '0-1-2-3'
        if (!outsideEdge)
          expect(contains(near, shape.anchor.x, shape.anchor.y), `${shape.id} at ${n}`).toBe(true)
      }
    }
  })

  it('draws every number, zero and the outside bets as cells', () => {
    const cells = new Set(layout.cells.map((c) => c.id))
    for (const spot of SPOTS) {
      const isCell =
        spot.kind !== 'split' &&
        spot.kind !== 'street' &&
        spot.kind !== 'corner' &&
        spot.kind !== 'line'
      expect(cells.has(spot.id), spot.id).toBe(isCell)
    }
  })
})
