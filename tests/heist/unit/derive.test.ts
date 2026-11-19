/**
 * The browser's own heist helpers: the immunity countdown on the top bar's
 * shield button, short enough for a button the size of the economy's.
 */
import { describe, expect, it } from 'vitest'

import { barCountdown } from '../../../src/features/heist/derive.ts'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

describe('the top bar’s immunity countdown', () => {
  it('shows hours and minutes from an hour up', () => {
    expect(barCountdown(3 * HOUR)).toBe('3h00')
    expect(barCountdown(2 * HOUR + 5 * MINUTE + 59 * SECOND)).toBe('2h05')
    expect(barCountdown(HOUR)).toBe('1h00')
  })

  it('shows minutes and seconds in the last hour', () => {
    expect(barCountdown(HOUR - 1)).toBe('59:59')
    expect(barCountdown(MINUTE + SECOND)).toBe('1:01')
    expect(barCountdown(9 * SECOND)).toBe('0:09')
  })

  it('rounds down and never goes below zero', () => {
    expect(barCountdown(999)).toBe('0:00')
    expect(barCountdown(0)).toBe('0:00')
    expect(barCountdown(-5 * SECOND)).toBe('0:00')
  })
})
