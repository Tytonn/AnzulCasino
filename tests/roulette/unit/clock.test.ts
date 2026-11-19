/**
 * The wheel's clock (spec: Clock): 20 seconds of betting, 7 of spin and 3 of
 * result, so every browser is in the same spin by definition. Spin n of a
 * season opens at start + n * cycle until an admin changes the timings, when
 * the schedule carries on from the latest spin that ran.
 */
import { describe, expect, it } from 'vitest'

import {
  cycleMs,
  phaseAt,
  seasonClock,
  spinAt,
  spinWindow,
  timingFromConfig,
} from '../../../shared/games/roulette.ts'
import { clockFrom, savedWindow, windowOf } from '../../../server/games/roulette/rules.ts'

const timing = timingFromConfig({
  roulette_betting_seconds: 20,
  roulette_spin_seconds: 7,
  roulette_result_seconds: 3,
})
const start = Date.UTC(2026, 10, 1)
const s = 1000

describe('the clock', () => {
  it('reads its timings from config', () => {
    expect(timing).toEqual({ bettingMs: 20_000, spinMs: 7_000, resultMs: 3_000 })
    expect(cycleMs(timing)).toBe(30_000)
  })

  it("numbers spins floor((time - season start) / cycle) from the season's start", () => {
    const clock = seasonClock(start, timing)
    expect(spinAt(clock, start).spin).toBe(0)
    expect(spinAt(clock, start + 29_999).spin).toBe(0)
    expect(spinAt(clock, start + 30_000).spin).toBe(1)
    for (const t of [12 * s, 3_600 * s + 17, 86_400 * s * 3 + 29_999]) {
      expect(spinAt(clock, start + t).spin).toBe(Math.floor(t / 30_000))
    }
  })

  it('runs betting, then the spin, then the result', () => {
    const w = spinAt(seasonClock(start, timing), start + 95 * s)
    expect(w).toEqual({
      spin: 3,
      opensAt: start + 90 * s,
      closesAt: start + 110 * s,
      landsAt: start + 117 * s,
      endsAt: start + 120 * s,
    })
    expect(phaseAt(w, w.opensAt)).toBe('betting')
    expect(phaseAt(w, w.closesAt - 1)).toBe('betting')
    expect(phaseAt(w, w.closesAt)).toBe('spinning')
    expect(phaseAt(w, w.landsAt - 1)).toBe('spinning')
    expect(phaseAt(w, w.landsAt)).toBe('result')
  })

  it('agrees with the season formula when it anchors on a saved spin', () => {
    const plain = seasonClock(start, timing)
    const saved = {
      roundNo: 41,
      opensAt: new Date(start + 41 * 30 * s),
      result: { timing, number: 9 },
    }
    const anchored = clockFrom(saved, new Date(start), timing)
    for (const t of [41 * 30 * s, 50 * 30 * s + 5 * s, 400 * 30 * s + 25 * s]) {
      expect(spinAt(anchored, start + t)).toEqual(spinAt(plain, start + t))
    }
    expect(clockFrom(null, new Date(start), timing)).toEqual(plain)
  })

  it('carries on from the latest spin when an admin changes the timings', () => {
    // Spin 41 ran at 20/7/3. Betting is now 30 seconds: spin 41 keeps its
    // times and spin 42 opens when it ends, at the new length.
    const saved = {
      roundNo: 41,
      opensAt: new Date(start + 41 * 30 * s),
      result: { timing, number: 9 },
    }
    const longer = { ...timing, bettingMs: 30_000 }
    const clock = clockFrom(saved, new Date(start), longer)
    expect(clock.anchor).toEqual(spinWindow(41, start + 1_230 * s, timing))
    const next = spinAt(clock, start + 1_260 * s)
    expect(next).toEqual(spinWindow(42, start + 1_260 * s, longer))
    expect(spinAt(clock, start + 1_260 * s + 40 * s).spin).toBe(43)
    expect(windowOf(clock, 43)).toEqual(spinWindow(43, start + 1_300 * s, longer))
    expect(windowOf(clock, 41)).toEqual(clock.anchor)
    expect(windowOf(clock, 40)).toBeNull()
  })

  it("uses a saved spin's own timings, or today's when it has none", () => {
    const saved = { roundNo: 3, opensAt: new Date(start), result: null }
    expect(savedWindow(saved, timing)).toEqual(spinWindow(3, start, timing))
    const slow = { bettingMs: 60_000, spinMs: 10_000, resultMs: 5_000 }
    const stored = { roundNo: 3, opensAt: new Date(start), result: { timing: slow, number: null } }
    expect(savedWindow(stored, timing)).toEqual(spinWindow(3, start, slow))
  })
})
