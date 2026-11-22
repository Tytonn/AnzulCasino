/**
 * The command and stream settings (spec: Commands): the prefix, each
 * command's words, and the stream's two switches.
 */
import { describe, expect, it } from 'vitest'

import {
  COMMAND_KEYS,
  commandWordClash,
  type ConfigValues,
  configDefaults,
  configWireValue,
  formatConfigValue,
  parseConfigValue,
  setting,
  waitsForReset,
} from '../../../shared/config.ts'

const defaults = configDefaults()

describe('command settings', () => {
  it('give every command its words from the plan, with the name first', () => {
    const words = Object.fromEntries(COMMAND_KEYS.map((key) => [key, defaults[key]]))
    expect(words).toEqual({
      command_blackjack: ['bj', 'blackjack'],
      command_roulette: ['roulette', 'rl'],
      command_coinflip: ['flip', 'coinflip', 'cf'],
      command_crash: ['crash'],
      command_mines: ['mines'],
      command_plinko: ['plinko'],
      command_slots: ['slots'],
      command_russian_roulette: ['rr'],
      command_race: ['race'],
      command_work: ['work', 'w'],
      command_hustle: ['slut'],
      command_crime: ['crime'],
      command_collect: ['collect'],
      command_rob: ['rob', 'steal'],
      command_deposit: ['dep', 'deposit'],
      command_withdraw: ['with', 'withdraw'],
      command_balance: ['bal', 'balance'],
      command_leaderboard: ['lb', 'leaderboard', 'top'],
      command_shop: ['shop', 'store'],
      command_help: ['help', 'commands'],
      command_admin: ['admin'],
    })
    expect(defaults.command_prefix).toBe('.')
  })

  it('never give two commands the same word by default', () => {
    const all = COMMAND_KEYS.flatMap((key) => defaults[key])
    expect(new Set(all).size).toBe(all.length)
    for (const key of COMMAND_KEYS) {
      expect(commandWordClash(key, defaults[key], {}), key).toBeUndefined()
      expect(setting(key).group).toBe('commands')
    }
  })

  it('take effect at once', () => {
    expect(waitsForReset('command_prefix')).toBe(false)
    expect(waitsForReset('command_blackjack')).toBe(false)
    expect(waitsForReset('stream_round_runs')).toBe(false)
    expect(waitsForReset('stream_bal_lb')).toBe(false)
  })
})

describe('the command prefix', () => {
  it('is one to three symbols', () => {
    expect(parseConfigValue('command_prefix', '!')).toEqual({ ok: true, value: '!' })
    expect(parseConfigValue('command_prefix', ' $$ ')).toEqual({ ok: true, value: '$$' })
    expect(parseConfigValue('command_prefix', '>>>')).toEqual({ ok: true, value: '>>>' })
    expect(parseConfigValue('command_prefix', '🎲')).toEqual({ ok: true, value: '🎲' })
  })

  it('refuses letters, digits, spaces, @ and long prefixes', () => {
    const refused = {
      ok: false,
      error: 'command_prefix must be 1 to 3 symbols, with no letters, digits, spaces or @.',
    }
    expect(parseConfigValue('command_prefix', 'c')).toEqual(refused)
    expect(parseConfigValue('command_prefix', '.1')).toEqual(refused)
    expect(parseConfigValue('command_prefix', '! !')).toEqual(refused)
    expect(parseConfigValue('command_prefix', '@')).toEqual(refused)
    expect(parseConfigValue('command_prefix', 'é')).toEqual(refused)
    expect(parseConfigValue('command_prefix', '....')).toEqual({
      ok: false,
      error: 'command_prefix must be 1 to 3 characters.',
    })
    expect(parseConfigValue('command_prefix', '')).toMatchObject({ ok: false })
    expect(parseConfigValue('command_prefix', 5)).toMatchObject({ ok: false })
  })
})

describe("a command's words", () => {
  it('are trimmed and lowercased', () => {
    expect(parseConfigValue('command_blackjack', [' BJ ', 'Blackjack', 'bj21'])).toEqual({
      ok: true,
      value: ['bj', 'blackjack', 'bj21'],
    })
    expect(configWireValue(defaults.command_blackjack)).toEqual(['bj', 'blackjack'])
    expect(formatConfigValue('command_blackjack', defaults.command_blackjack)).toBe('bj, blackjack')
  })

  it('refuse spaces, symbols, a leading digit, repeats and long lists', () => {
    expect(parseConfigValue('command_blackjack', ['b j'])).toEqual({
      ok: false,
      error:
        '"b j" cannot be a word for Blackjack: use 1 to 16 letters and digits, starting with a letter.',
    })
    expect(parseConfigValue('command_blackjack', ['bj!'])).toMatchObject({ ok: false })
    expect(parseConfigValue('command_blackjack', ['21'])).toMatchObject({ ok: false })
    expect(parseConfigValue('command_blackjack', ['x'.repeat(17)])).toMatchObject({ ok: false })
    expect(parseConfigValue('command_blackjack', ['bj', ' '])).toEqual({
      ok: false,
      error:
        'An empty word cannot be a word for Blackjack: use 1 to 16 letters and digits, starting with a letter.',
    })
    expect(parseConfigValue('command_blackjack', ['bj', 'BJ'])).toEqual({
      ok: false,
      error: 'Blackjack has "bj" twice.',
    })
    expect(parseConfigValue('command_blackjack', [])).toEqual({
      ok: false,
      error: 'Blackjack needs between 1 and 8 words.',
    })
    const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
    expect(parseConfigValue('command_blackjack', nine)).toMatchObject({ ok: false })
    expect(parseConfigValue('command_blackjack', 'bj')).toEqual({
      ok: false,
      error: 'command_blackjack must be a list of words.',
    })
  })

  it("clash with another command's words, at its current value", () => {
    expect(commandWordClash('command_roulette', ['roulette', 'bj'], {})).toBe(
      '"bj" already belongs to Blackjack.',
    )
    // Once Blackjack lets go of "bj", Roulette may take it.
    const current = { command_blackjack: ['blackjack', 'twentyone'] }
    expect(commandWordClash('command_roulette', ['roulette', 'bj'], current)).toBeUndefined()
    expect(commandWordClash('command_roulette', ['twentyone'], current)).toBe(
      '"twentyone" already belongs to Blackjack.',
    )
    // A command never clashes with itself.
    expect(commandWordClash('command_blackjack', ['bj', 'blackjack'], {})).toBeUndefined()
  })
})

describe('the stream switches', () => {
  it('default to folding runs and private .bal and .lb', () => {
    const runs: 'fold' | 'separate' = defaults.stream_round_runs
    const balLb: ConfigValues['stream_bal_lb'] = defaults.stream_bal_lb
    expect([runs, balLb]).toEqual(['fold', 'private'])
  })

  it('take one of their options and read as its label', () => {
    expect(parseConfigValue('stream_round_runs', 'separate')).toEqual({
      ok: true,
      value: 'separate',
    })
    expect(parseConfigValue('stream_bal_lb', 'public')).toEqual({ ok: true, value: 'public' })
    expect(parseConfigValue('stream_round_runs', 'Fold')).toEqual({
      ok: false,
      error: 'stream_round_runs must be fold or separate.',
    })
    expect(parseConfigValue('stream_bal_lb', true)).toMatchObject({ ok: false })
    expect(formatConfigValue('stream_round_runs', 'fold')).toBe('Fold into one line')
    expect(formatConfigValue('stream_bal_lb', 'public')).toBe('Posted in the stream')
    expect(configWireValue('separate')).toBe('separate')
  })
})
