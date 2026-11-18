import { describe, expect, it } from 'vitest'

import { chips } from '../../../shared/chips.ts'
import {
  CONFIG,
  CONFIG_GROUPS,
  CONFIG_KEYS,
  CONFIG_PAIRS,
  configDefaults,
  configPair,
  configWireValue,
  formatConfigValue,
  parseConfigValue,
  setting,
  tierSettings,
  waitsForReset,
} from '../../../shared/config.ts'

const defaults = configDefaults()

describe('config defaults', () => {
  it('describe every setting and keep each default inside its limits', () => {
    for (const key of CONFIG_KEYS) {
      const s = setting(key)
      expect(s.description, key).toMatch(/^[A-Z].*\.$/)
      expect(CONFIG_GROUPS, key).toContain(s.group)
      expect(key, 'snake_case keys').toMatch(/^[a-z][a-z0-9_]*$/)
      if (s.unit === 'lines') {
        expect(parseConfigValue(key, [...s.default]), key).toEqual({ ok: true, value: s.default })
        continue
      }
      if (s.unit === 'chips') expect(typeof s.default, key).toBe('bigint')
      else expect(Number.isSafeInteger(s.default), key).toBe(true)
      expect(s.default >= s.min && s.default <= s.max, key).toBe(true)
    }
  })

  it('use the spec values after the 1/100 rebalance', () => {
    expect(defaults.starting_balance).toBe(chips(100))
    expect(defaults.min_bet).toBe(chips(1))
    expect(defaults.streak_step).toBe(chips(1))
    expect(defaults.streak_max).toBe(chips(10))
    expect([defaults.challenge_reward_min, defaults.challenge_reward_max]).toEqual([
      chips(2),
      chips(4),
    ])
    expect(defaults.steal_floor).toBe(chips(25))
    expect(defaults.shield_price_min).toBe(chips(3))
    expect(defaults.tier_base_income).toBe(chips(5))
  })

  it('keep the spec percentages, in basis points', () => {
    expect(defaults.max_bet_pct).toBe(10_000)
    expect(defaults.big_bet_pct).toBe(5_000)
    expect(defaults.steal_success_pct).toBe(5_500)
    expect(defaults.steal_base_rate).toBe(150)
    expect(defaults.steal_per_rank).toBe(30)
    expect(defaults.steal_max_rate).toBe(400)
    expect(defaults.steal_down_rate).toBe(50)
    expect(defaults.daily_loss_cap_pct).toBe(400)
    expect(defaults.steal_fine_pct).toBe(500)
    expect(defaults.shield_price_pct).toBe(200)
    expect(defaults.vault_cap_pct).toBe(2_500)
    expect([
      defaults.mines_edge_pct,
      defaults.plinko_edge_pct,
      defaults.crash_edge_pct,
      defaults.slots_edge_pct,
    ]).toEqual([200, 200, 300, 400])
  })

  it("use Tyton's corrected work and crime values, with no rebuy", () => {
    expect(defaults.work_cooldown_minutes).toBe(5)
    expect([defaults.work_pay_min, defaults.work_pay_max]).toEqual([chips(2), chips(6)])
    expect(defaults.crime_cooldown_minutes).toBe(15)
    expect(defaults.crime_success_pct).toBe(4_500)
    expect([defaults.crime_pay_min, defaults.crime_pay_max]).toEqual([chips(8), chips(25)])
    expect([defaults.crime_fine_min, defaults.crime_fine_max]).toEqual([chips(2), chips(8)])
    expect(defaults.crime_chat_min, 'the top of the crime range').toBe(chips(23))
    expect(CONFIG_KEYS.filter((key) => key.includes('rebuy'))).toEqual([])
  })

  it('give russian roulette and race their starting values', () => {
    expect(defaults.russian_roulette_join_seconds).toBe(20)
    expect(defaults.russian_roulette_turn_seconds).toBe(10)
    expect(defaults.russian_roulette_solo_edge_pct).toBe(200)
    expect(defaults.russian_roulette_ante_cap_pct).toBe(2_000)
    expect(defaults.race_edge_pct).toBe(500)
    const cycle =
      defaults.race_betting_seconds + defaults.race_running_seconds + defaults.race_result_seconds
    expect(cycle, 'about every 75 seconds').toBe(75)
  })

  it('keep every range in order, and find a pair from either side', () => {
    for (const [min, max] of CONFIG_PAIRS) {
      expect(defaults[min] <= defaults[max], `${min} <= ${max}`).toBe(true)
      expect(setting(min).unit).toBe(setting(max).unit)
      expect(setting(min).group).toBe(setting(max).group)
    }
    expect(configPair('work_pay_max')).toEqual(['work_pay_min', 'work_pay_max'])
    expect(configPair('min_bet')).toBeUndefined()
  })

  it('give every rank its price, income and unlock day', () => {
    expect(tierSettings(defaults, 'base')).toEqual({ price: 0n, income: chips(5), unlockDay: 0 })
    expect(tierSettings(defaults, 'bronze')).toEqual({
      price: chips(150),
      income: chips(15),
      unlockDay: 1,
    })
    expect(tierSettings(defaults, 'silver')).toEqual({
      price: chips(1_000),
      income: chips(100),
      unlockDay: 3,
    })
    expect(tierSettings(defaults, 'crown')).toEqual({
      price: chips(10_000_000),
      income: chips(1_000_000),
      unlockDay: 18,
    })
  })

  it('wait for the daily reset only for the economy and steals', () => {
    expect(waitsForReset('steal_success_pct')).toBe(true)
    expect(waitsForReset('shield_price_pct')).toBe(true)
    expect(waitsForReset('tier_gold_price')).toBe(true)
    expect(waitsForReset('work_pay_max')).toBe(true)
    expect(waitsForReset('crime_success_pct')).toBe(true)
    expect(waitsForReset('work_lines')).toBe(false)
    expect(waitsForReset('min_bet')).toBe(false)
    expect(waitsForReset('roulette_betting_seconds')).toBe(false)
  })
})

describe('config values', () => {
  it('are plain numbers on the wire, chips as hundredths', () => {
    expect(parseConfigValue('min_bet', 250)).toEqual({ ok: true, value: 250n })
    expect(parseConfigValue('steal_base_rate', 175)).toEqual({ ok: true, value: 175 })
  })

  it('are refused outside their unit and limits', () => {
    expect(parseConfigValue('min_bet', -1)).toMatchObject({ ok: false })
    expect(parseConfigValue('min_bet', 1.5)).toMatchObject({ ok: false })
    expect(parseConfigValue('min_bet', '100')).toMatchObject({ ok: false })
    expect(parseConfigValue('steal_success_pct', 10_001)).toEqual({
      ok: false,
      error: 'steal_success_pct must be between 0% and 100%.',
    })
    expect(parseConfigValue('starting_balance', 0)).toEqual({
      ok: false,
      error: 'starting_balance must be between 1 chip and 1,000,000,000 chips.',
    })
  })

  it('read well for people', () => {
    expect(formatConfigValue('starting_balance', chips(100))).toBe('100 chips')
    expect(formatConfigValue('steal_base_rate', 150)).toBe('1.5%')
    expect(formatConfigValue('immunity_hours', 3)).toBe('3 hours')
    expect(formatConfigValue('immunity_hours', 1)).toBe('1 hour')
    expect(formatConfigValue('crash_max_multiplier', 1_000)).toBe('1000x')
    expect(formatConfigValue('steal_attempts_per_day', 2)).toBe('2')
  })

  it('can be lists of plain-text lines', () => {
    expect(
      parseConfigValue('work_lines', ['  You mopped the floor. ', 'You sold popcorn.']),
    ).toEqual({
      ok: true,
      value: ['You mopped the floor.', 'You sold popcorn.'],
    })
    expect(parseConfigValue('work_lines', [])).toEqual({
      ok: false,
      error: 'work_lines needs between 1 and 50 lines.',
    })
    expect(parseConfigValue('work_lines', ['fine', '  '])).toMatchObject({ ok: false })
    expect(parseConfigValue('work_lines', ['x'.repeat(121)])).toMatchObject({ ok: false })
    expect(parseConfigValue('work_lines', ['two\nlines'])).toMatchObject({ ok: false })
    expect(parseConfigValue('work_lines', 'one line')).toMatchObject({ ok: false })
    expect(parseConfigValue('work_lines', [1, 2])).toMatchObject({ ok: false })
    expect(parseConfigValue('min_bet', ['1'])).toMatchObject({ ok: false })
    expect(formatConfigValue('work_lines', defaults.work_lines)).toBe('10 lines')
    expect(configWireValue(defaults.work_lines)).toEqual([...defaults.work_lines])
    expect(configWireValue(chips(3))).toBe(300)
  })

  it('are typed: chips as bigint, the rest as numbers', () => {
    const minBet: bigint = defaults.min_bet
    const rate: number = defaults.steal_base_rate
    expect([typeof minBet, typeof rate]).toEqual(['bigint', 'number'])
    expect(Object.keys(defaults)).toEqual(Object.keys(CONFIG))
  })
})
