/**
 * The browser's own heist helpers: who the Rob list and a player's card
 * offer to rob once you are out of attempts, and the immunity countdown on
 * the top bar's shield button.
 */
import { describe, expect, it } from 'vitest'

import { configDefaults } from '../../../shared/config.ts'
import type { HeistState, TargetInfo } from '../../../shared/features/heist.ts'
import type { StandingView } from '../../../shared/seasons.ts'
import { barCountdown, heistConfig, targetRows } from '../../../src/features/heist/derive.ts'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const cfg = heistConfig(configDefaults())
const NOW = Date.parse('2026-11-19T20:00:00Z')

function standing(userId: string, rank: number): StandingView {
  return {
    rank,
    userId,
    username: userId,
    displayName: userId,
    avatar: 'spade',
    avatarColor: 'cyan',
    tier: 'base',
    balance: 10_000,
    vault: 0,
    netWorth: 10_000,
    version: 1,
  }
}

function target(userId: string, facts: Partial<TargetInfo> = {}): TargetInfo {
  return { userId, immuneUntil: null, triedToday: false, capLeft: 2_000, ...facts }
}

function rows(attemptsUsed: number) {
  const state: HeistState = {
    seasonId: 1,
    phase: 'open',
    gameDay: '2026-11-19',
    nextResetAt: '2026-11-20T10:00:00.000Z',
    freezeAt: null,
    me: {
      attemptsUsed,
      attemptsAllowed: 2,
      extraBought: false,
      charges: 0,
      immuneUntil: null,
      shieldsThisWeek: 0,
      weekEndsAt: null,
      vaultMoved: false,
      stolenToday: 0,
      lossCap: 2_000,
    },
    targets: [
      target('fresh'),
      target('tried', { triedToday: true }),
      target('immune', { immuneUntil: new Date(NOW + HOUR).toISOString() }),
    ],
  }
  const standings = [
    standing('me', 1),
    standing('fresh', 2),
    standing('tried', 3),
    standing('immune', 4),
  ]
  const list = targetRows({ standings, meId: 'me', state, phase: 'open', now: NOW, cfg })
  return (id: string) => {
    const row = list.find((r) => r.standing.userId === id)
    if (!row) throw new Error(`no row for ${id}`)
    return row
  }
}

const reason = (check: { ok: boolean; reason?: string }) => (check.ok ? 'ok' : check.reason)

describe('who you are offered once you are out of attempts', () => {
  it('with an attempt left, says why each blocked player cannot be robbed', () => {
    const row = rows(1)
    expect(reason(row('fresh').check)).toBe('ok')
    expect(reason(row('tried').check)).toBe('tried')
    expect(reason(row('immune').check)).toBe('immune')
  })

  it('out of attempts, offers the extra attempt only for players it would let you rob', () => {
    const row = rows(2)
    expect(reason(row('fresh').check)).toBe('no_attempts')
    expect(row('fresh').worth.ok).toBe(true)
    // The extra attempt would not help with these, so they say why.
    expect(reason(row('tried').check)).toBe('tried')
    expect(reason(row('immune').check)).toBe('immune')
  })
})

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
