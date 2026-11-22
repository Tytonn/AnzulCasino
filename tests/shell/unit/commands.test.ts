/**
 * Reading the message box (spec: Commands): what is a command, what is chat,
 * what the list offers while typing, and what is refused before anything
 * is sent.
 */
import { describe, expect, it } from 'vitest'

import type { PlayerSummary } from '../../../shared/players.ts'
import { COINFLIP_COMMANDS } from '../../../src/games/coinflip/commands.ts'
import type { CommandSpec } from '../../../src/shell/manifests.ts'
import {
  checkArgs,
  findPlayer,
  listFor,
  parseInput,
  playerMatches,
  resolveCommands,
  splitChoice,
  suggest,
  unknownHint,
} from '../../../src/shell/stream/commands.ts'

const run = () => {}
const BLACKJACK: CommandSpec = {
  key: 'command_blackjack',
  args: 'bet',
  example: '50',
  needs: 'amount',
  description: 'Deal a hand.',
  run,
}
const SPECS: CommandSpec[] = [
  BLACKJACK,
  { key: 'command_work', description: 'Earn a few chips.', run },
  { key: 'command_balance', args: 'player', description: 'Your chips.', run },
  { key: 'command_rob', args: 'player', needs: 'player', description: 'Steal.', run },
  { key: 'command_deposit', args: 'amount', needs: 'amount', description: 'Vault.', run },
  { key: 'command_crash', soon: true, description: 'Coming soon.', run },
]

const commands = resolveCommands(SPECS, undefined)
const words = (key: string) => commands.find((c) => c.key === key)?.words

describe('resolveCommands', () => {
  it('takes each command’s words from its setting, or the default', () => {
    expect(words('command_blackjack')).toEqual(['bj', 'blackjack'])
    const renamed = resolveCommands(SPECS, { command_blackjack: ['21', 'bj'] } as never)
    expect(renamed.find((c) => c.key === 'command_blackjack')?.words).toEqual(['21', 'bj'])
  })

  it('leaves out a command with no words, and a second spec on one setting', () => {
    const none = resolveCommands(SPECS, { command_work: [] } as never)
    expect(none.some((c) => c.key === 'command_work')).toBe(false)
    const twice = resolveCommands([...SPECS, { ...BLACKJACK, description: 'Again.' }], undefined)
    expect(twice.filter((c) => c.key === 'command_blackjack')).toHaveLength(1)
    expect(twice.find((c) => c.key === 'command_blackjack')?.spec.description).toBe('Deal a hand.')
  })
})

describe('parseInput', () => {
  it('reads a command, its word and what follows', () => {
    const parsed = parseInput('.bj 50', '.', commands)
    expect(parsed).toMatchObject({ kind: 'command', word: 'bj', args: '50' })
    expect(parseInput('.BlackJack   half ', '.', commands)).toMatchObject({
      kind: 'command',
      word: 'blackjack',
      args: 'half',
    })
  })

  it('keeps anything else as chat, the prefix on its own as the prefix', () => {
    expect(parseInput('hello', '.', commands).kind).toBe('chat')
    expect(parseInput('...', '.', commands).kind).toBe('chat')
    expect(parseInput('.5 is my lucky number', '.', commands).kind).toBe('chat')
    expect(parseInput('.', '.', commands).kind).toBe('prefix')
    expect(parseInput('!bj 50', '!', commands).kind).toBe('command')
    expect(parseInput('.bj 50', '!', commands).kind).toBe('chat')
  })

  it('names an unknown command with what was probably meant', () => {
    expect(parseInput('.bjj 50', '.', commands)).toMatchObject({
      kind: 'unknown',
      word: 'bjj',
      suggestion: '.bj',
    })
  })
})

describe('suggest', () => {
  it('splits a word that ran into its amount', () => {
    expect(suggest('bj50', '.', commands)).toBe('.bj 50')
  })

  it('takes a word one or two letters off, or one it starts', () => {
    expect(suggest('wrok', '.', commands)).toBe('.work')
    expect(suggest('blakjack', '.', commands)).toBe('.blackjack')
    expect(suggest('depos', '.', commands)).toBe('.dep')
    expect(suggest('zzzzzz', '.', commands)).toBeNull()
  })

  it('says so in a sentence', () => {
    expect(unknownHint('bjj', '.', '.bj')).toBe('There is no .bjj. Did you mean .bj?')
    expect(unknownHint('zz', '.', null)).toBe('There is no .zz. Type .help to see every command.')
  })
})

describe('listFor', () => {
  it('lists every command for the prefix alone, without games still to come', () => {
    const rows = listFor('.', '.', commands)
    expect(rows?.map((r) => r.command.key)).toEqual([
      'command_blackjack',
      'command_work',
      'command_balance',
      'command_rob',
      'command_deposit',
    ])
  })

  it('puts an exact word first, then names, then aliases', () => {
    const rows = listFor('.b', '.', commands)
    expect(rows?.map((r) => r.word)).toEqual(['bj', 'bal'])
    expect(listFor('.bal', '.', commands)?.[0]?.word).toBe('bal')
    expect(listFor('.black', '.', commands)?.map((r) => r.word)).toEqual(['blackjack'])
    expect(listFor('.cr', '.', commands)?.map((r) => r.word)).toEqual(['crash'])
  })

  it('closes once the word is done, and for chat', () => {
    expect(listFor('.bj ', '.', commands)).toBeNull()
    expect(listFor('hello', '.', commands)).toBeNull()
  })
})

describe('checkArgs', () => {
  const bj = commands.find((c) => c.key === 'command_blackjack')
  const rob = commands.find((c) => c.key === 'command_rob')
  const dep = commands.find((c) => c.key === 'command_deposit')
  if (!bj || !rob || !dep) throw new Error('missing commands')

  it('asks for a bet in the words the player typed', () => {
    expect(checkArgs(bj, '.bj', '')).toBe('.bj needs a bet, like .bj 50 or .bj all.')
    expect(checkArgs(dep, '.dep', '')).toBe('.dep needs an amount, like .dep 50 or .dep all.')
    expect(checkArgs(bj, '.bj', 'lots')).toMatch(/is not an amount/)
    expect(checkArgs(bj, '.bj', '2.5k')).toBeNull()
    expect(checkArgs(bj, '.bj', 'half')).toBeNull()
  })

  it('asks for a player', () => {
    expect(checkArgs(rob, '.rob', '')).toBe('.rob needs a player, like .rob alice.')
    expect(checkArgs(rob, '.rob', 'bob')).toBeNull()
  })

  it('reads the amount around a side, and refuses two sides', () => {
    const flip = resolveCommands(COINFLIP_COMMANDS, undefined)[0]
    if (!flip) throw new Error('missing .flip')
    expect(checkArgs(flip, '.flip', '50 heads')).toBeNull()
    expect(checkArgs(flip, '.flip', 'T 2.5k')).toBeNull()
    expect(checkArgs(flip, '.flip', 'all')).toBeNull()
    expect(checkArgs(flip, '.flip', 'heads')).toBe(
      '.flip needs a bet, like .flip 50 heads or .flip all.',
    )
    expect(checkArgs(flip, '.flip', '50 heads t')).toBe('Pick one: heads or tails.')
    expect(checkArgs(flip, '.flip', '50 head')).toMatch(/is not an amount/)
  })
})

describe('splitChoice', () => {
  const sides = COINFLIP_COMMANDS[0]?.choices

  it('takes the side out wherever it stands, by any of its words', () => {
    expect(splitChoice('50 heads', sides)).toEqual({ ok: true, rest: '50', choice: 'heads' })
    expect(splitChoice('t 50', sides)).toEqual({ ok: true, rest: '50', choice: 'tails' })
    expect(splitChoice('  Tails   half ', sides)).toEqual({
      ok: true,
      rest: 'half',
      choice: 'tails',
    })
    expect(splitChoice('2.5 k h', sides)).toEqual({ ok: true, rest: '2.5 k', choice: 'heads' })
    expect(splitChoice('h heads 50', sides)).toEqual({ ok: true, rest: '50', choice: 'heads' })
  })

  it('leaves the amount alone without a side, or for a command with no sides', () => {
    expect(splitChoice('50', sides)).toEqual({ ok: true, rest: '50', choice: null })
    expect(splitChoice('50 heads', undefined)).toEqual({
      ok: true,
      rest: '50 heads',
      choice: null,
    })
  })

  it('refuses two different sides', () => {
    expect(splitChoice('h 50 t', sides)).toEqual({ ok: false, error: 'Pick one: heads or tails.' })
    const three = [['red'], ['black'], ['green']] as const
    expect(splitChoice('red green', three)).toEqual({
      ok: false,
      error: 'Pick one: red, black or green.',
    })
  })
})

describe('players', () => {
  const player = (id: string, username: string, displayName: string) =>
    ({ id, username, displayName }) as PlayerSummary
  const players = [
    player('1', 'alice', 'Alice'),
    player('2', 'bob', 'Bob'),
    player('3', 'bobby', 'Bobby Tables'),
  ]

  it('finds a player by name, with or without the @', () => {
    expect(findPlayer(players, '@Alice')?.id).toBe('1')
    expect(findPlayer(players, 'ali')?.id).toBe('1')
    expect(findPlayer(players, 'bob')?.id).toBe('2')
    // Two players start with "bo": nobody in particular.
    expect(findPlayer(players, 'bo')).toBeUndefined()
    expect(findPlayer(players, '')).toBeUndefined()
  })

  it('lists who matches, leaving one out', () => {
    expect(playerMatches(players, 'bo').map((p) => p.id)).toEqual(['2', '3'])
    expect(playerMatches(players, '', '1').map((p) => p.id)).toEqual(['2', '3'])
  })
})
