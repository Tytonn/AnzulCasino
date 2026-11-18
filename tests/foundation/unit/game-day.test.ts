import { describe, expect, it } from 'vitest'

import {
  addGameDays,
  gameDay,
  gameDayStart,
  nextReset,
  seasonDay,
} from '../../../shared/game-day.ts'

const at = (iso: string) => new Date(iso)

describe('the game day', () => {
  it('starts at 4:00 AM Central in winter (10:00 UTC)', () => {
    expect(gameDay(at('2026-11-18T09:59:59.999Z'))).toBe('2026-11-17')
    expect(gameDay(at('2026-11-18T10:00:00Z'))).toBe('2026-11-18')
    expect(gameDayStart('2026-11-18')).toEqual(at('2026-11-18T10:00:00Z'))
  })

  it('starts at 4:00 AM Central in summer (09:00 UTC)', () => {
    expect(gameDay(at('2026-07-01T08:59:59Z'))).toBe('2026-06-30')
    expect(gameDay(at('2026-07-01T09:00:00Z'))).toBe('2026-07-01')
    expect(gameDayStart('2026-07-01')).toEqual(at('2026-07-01T09:00:00Z'))
  })

  it('keeps a late night in one day', () => {
    // 1:30 AM Central on Nov 19 still belongs to Nov 18.
    expect(gameDay(at('2026-11-19T07:30:00Z'))).toBe('2026-11-18')
  })

  it('follows the wall clock across daylight saving changes', () => {
    // Clocks jump forward on Mar 8, 2026: that game day starts at 4:00 CDT.
    expect(gameDayStart('2026-03-08')).toEqual(at('2026-03-08T09:00:00Z'))
    expect(gameDay(at('2026-03-08T08:59:59Z'))).toBe('2026-03-07')
    // Clocks fall back on Nov 1, 2026: that game day starts at 4:00 CST.
    expect(gameDayStart('2026-11-01')).toEqual(at('2026-11-01T10:00:00Z'))
    expect(gameDay(at('2026-11-01T09:59:59Z'))).toBe('2026-10-31')
    expect(gameDayStart('2026-10-31')).toEqual(at('2026-10-31T09:00:00Z'))
  })

  it('finds the next reset', () => {
    expect(nextReset(at('2026-11-18T12:00:00Z'))).toEqual(at('2026-11-19T10:00:00Z'))
    // 3:00 AM Central: the reset is an hour away, the same morning.
    expect(nextReset(at('2026-11-18T09:00:00Z'))).toEqual(at('2026-11-18T10:00:00Z'))
    expect(nextReset(at('2026-11-18T10:00:00Z'))).toEqual(at('2026-11-19T10:00:00Z'))
  })

  it('counts season days from 1', () => {
    const start = at('2026-12-01T10:00:00Z') // 4:00 AM Central, Dec 1
    expect(seasonDay(start, at('2026-11-30T12:00:00Z'))).toBe(0)
    expect(seasonDay(start, start)).toBe(1)
    expect(seasonDay(start, at('2026-12-02T09:59:59Z'))).toBe(1)
    expect(seasonDay(start, at('2026-12-02T10:00:00Z'))).toBe(2)
    expect(seasonDay(start, at('2026-12-31T10:00:00Z'))).toBe(31)
  })

  it('adds days across months and years', () => {
    expect(addGameDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addGameDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})
