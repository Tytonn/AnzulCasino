/**
 * The settings editor's arithmetic (spec: Admin panel > Config): every
 * setting has a section and a name people read, each unit is typed and
 * read back the way the server stores it, and the editor catches a word
 * two commands share before a save.
 */
import { describe, expect, it } from 'vitest'

import { CONFIG_KEYS, configDefaults, configWireValue, setting } from '../../../shared/config.ts'
import {
  formatWire,
  friendlyError,
  fromDraft,
  hundredthsText,
  parseHundredths,
  SECTIONS,
  sectionKeys,
  settingDescription,
  settingLabel,
  toDraft,
  unitSuffix,
  wordClash,
} from '../../../src/features/admin/config-edit.ts'

const defaults = Object.fromEntries(
  Object.entries(configDefaults()).map(([key, value]) => [key, configWireValue(value)]),
)

describe('sections and names', () => {
  it('puts every setting in exactly one section', () => {
    const groups = SECTIONS.map((s) => s.group)
    expect(new Set(groups).size).toBe(groups.length)
    const listed = SECTIONS.flatMap((s) => sectionKeys(s.group))
    expect([...listed].sort()).toEqual([...CONFIG_KEYS].sort())
  })

  it('names every setting in words, never by its key', () => {
    for (const key of CONFIG_KEYS) {
      const label = settingLabel(key, 'Grind')
      expect(label, key).toMatch(/^\S/)
      expect(label, key).not.toContain('_')
      expect(settingDescription(key, 'Grind'), key).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
    }
  })

  it('reads the keys as people would', () => {
    expect(settingLabel('command_prefix')).toBe('Prefix')
    expect(settingLabel('work_pay_max')).toBe('Work pay max')
    expect(settingLabel('work_cooldown_minutes')).toBe('Work cooldown')
    expect(settingLabel('crime_success_pct')).toBe('Crime success')
    expect(settingLabel('tier_bronze_price')).toBe('Bronze price')
    expect(settingLabel('command_blackjack')).toBe('Blackjack')
  })

  it('calls the third button by its name now', () => {
    expect(settingLabel('hustle_cooldown_minutes', 'Grind')).toBe('Grind cooldown')
    expect(settingLabel('command_hustle', 'Grind')).toBe('Grind')
    expect(settingDescription('command_hustle', 'Grind')).toMatch(/^Grind: /)
    expect(friendlyError('hustle_pay_max', 'hustle_pay_max must be at least 1.', 'Grind')).toBe(
      'Grind pay max must be at least 1.',
    )
  })

  it('puts the unit beside the number', () => {
    expect(unitSuffix('work_pay_min')).toBe('chips')
    expect(unitSuffix('crime_success_pct')).toBe('%')
    expect(unitSuffix('final_freeze_hours')).toBe('hours')
    expect(unitSuffix('steal_attempts_per_day')).toBe('')
  })
})

describe('typing amounts', () => {
  it('shows hundredths as chips, grouped, with cents only when there are some', () => {
    expect(hundredthsText(10_000)).toBe('100')
    expect(hundredthsText(250)).toBe('2.5')
    expect(hundredthsText(205)).toBe('2.05')
    expect(hundredthsText(1_000_000_000)).toBe('10,000,000')
  })

  it('reads what was typed back to hundredths', () => {
    expect(parseHundredths('5')).toBe(500)
    expect(parseHundredths(' 2.5 ')).toBe(250)
    expect(parseHundredths('1,000.25')).toBe(100_025)
    for (const bad of ['', 'five', '2.555', '-1', '1e3', '.5']) {
      expect(parseHundredths(bad), bad).toBeNull()
    }
    for (const value of [0, 1, 99, 100, 12_345, 1_000_000_000]) {
      expect(parseHundredths(hundredthsText(value))).toBe(value)
    }
  })
})

describe('drafts', () => {
  it('starts every input from the value in force, and reads it back unchanged', () => {
    for (const key of CONFIG_KEYS) {
      const back = fromDraft(key, toDraft(key, defaults[key]))
      expect(back, key).toEqual({ ok: true, value: defaults[key] })
    }
  })

  it('turns each unit into what the server stores', () => {
    expect(fromDraft('work_pay_max', '7.50')).toEqual({ ok: true, value: 750 })
    expect(fromDraft('crime_success_pct', '47.5')).toEqual({ ok: true, value: 4750 })
    expect(fromDraft('steal_attempts_per_day', '3')).toEqual({ ok: true, value: 3 })
    expect(fromDraft('command_race', [' Race ', 'RC'])).toEqual({ ok: true, value: ['race', 'rc'] })
    expect(fromDraft('work_lines', 'One line\n\n  Two lines  \n')).toEqual({
      ok: true,
      value: ['One line', 'Two lines'],
    })
    expect(fromDraft('stream_bal_lb', 'public')).toEqual({ ok: true, value: 'public' })
  })

  it('says what is wrong in the editor’s words', () => {
    expect(fromDraft('work_pay_max', 'lots')).toEqual({
      ok: false,
      error: 'Type a number of chips, such as 5 or 2.50.',
    })
    expect(fromDraft('crime_success_pct', '101')).toEqual({ ok: false, error: 'Use 0% to 100%.' })
    expect(fromDraft('steal_attempts_per_day', '2.5')).toEqual({
      ok: false,
      error: 'Type a whole number.',
    })
    expect(fromDraft('work_lines', '')).toEqual({ ok: false, error: 'Add at least one line.' })
    expect(fromDraft('hustle_name', '  ')).toEqual({ ok: false, error: 'Type a name.' })
    const prefix = fromDraft('command_prefix', 'x')
    expect(prefix.ok).toBe(false)
    if (!prefix.ok) expect(prefix.error).toMatch(/^Prefix /)
  })

  it('shows a value the way people read it', () => {
    expect(formatWire('work_pay_max', 600)).toBe('6 chips')
    expect(formatWire('crime_success_pct', 4500)).toBe('45%')
    expect(formatWire('stream_round_runs', 'fold')).toBe('Fold into one line')
  })
})

describe('words two commands share', () => {
  const commands = {
    command_blackjack: ['bj', 'blackjack'],
    command_roulette: ['roulette', 'rl'],
  }

  it('flags a word another command has', () => {
    expect(wordClash('command_roulette', ['roulette', 'bj'], commands)).toBe(
      '"bj" already belongs to Blackjack.',
    )
  })

  it('lets a command keep its own words, and take a word once it is free', () => {
    expect(wordClash('command_roulette', ['roulette', 'rl'], commands)).toBeUndefined()
    expect(
      wordClash('command_roulette', ['roulette', 'bj'], {
        ...commands,
        command_blackjack: ['blackjack'],
      }),
    ).toBeUndefined()
  })

  it('matches each command default to a section and a unit that takes words', () => {
    for (const key of sectionKeys('commands')) {
      if (key === 'command_prefix') continue
      expect(setting(key).unit, key).toBe('words')
    }
  })
})
