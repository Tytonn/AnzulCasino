/**
 * Typed bets (spec: Games > Roulette > Spaces): "<amount> <space>" as on
 * UnbelievaBoat, such as "200 odd", "600 2nd", "50 17" and "all red", after
 * .roulette. Splits, streets, corners and six lines are not typed spaces.
 * Typed amounts are resolved on the server against the wallet, one bet
 * after another.
 */
import { describe, expect, it } from 'vitest'

import {
  parseQuickBet,
  parseSpace,
  RouletteBetInput,
  RouletteSettleInput,
} from '../../../shared/games/roulette.ts'
import { resolveBets } from '../../../server/games/roulette/rules.ts'
import { readBets, withAmounts } from '../../../src/games/roulette/typed.ts'

const bets = (text: string) => {
  const parsed = parseQuickBet(text)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.bets
}

const error = (text: string) => {
  const parsed = parseQuickBet(text)
  if (parsed.ok) throw new Error(`"${text}" should not parse`)
  return parsed.error
}

describe('typed bets', () => {
  it("reads the spec's examples", () => {
    expect(bets('200 odd')).toEqual([{ amount: '200', spot: 'odd' }])
    expect(bets('600 2nd')).toEqual([{ amount: '600', spot: 'col2' }])
    expect(bets('50 17')).toEqual([{ amount: '50', spot: '17' }])
    expect(bets('all red')).toEqual([{ amount: 'all', spot: 'red' }])
  })

  it('takes every space the spec lists', () => {
    const spaces: Record<string, string> = {
      '0': '0',
      '36': '36',
      '1-12': '1st12',
      '13-24': '2nd12',
      '25-36': '3rd12',
      '1st': 'col1',
      '2nd': 'col2',
      '3rd': 'col3',
      '1-18': 'low',
      '19-36': 'high',
      odd: 'odd',
      even: 'even',
      red: 'red',
      black: 'black',
    }
    for (const [space, spot] of Object.entries(spaces)) {
      expect(bets(`10 ${space}`), space).toEqual([{ amount: '10', spot }])
    }
  })

  it('forgives case, spacing, long dashes and friendly words', () => {
    expect(bets('  25   RED ')).toEqual([{ amount: '25', spot: 'red' }])
    expect(bets('25 1 – 12')).toEqual([{ amount: '25', spot: '1st12' }])
    expect(bets('5 green')).toEqual([{ amount: '5', spot: '0' }])
    expect(bets('5 zero')).toEqual([{ amount: '5', spot: '0' }])
    expect(bets('5 2nd column')).toEqual([{ amount: '5', spot: 'col2' }])
    expect(bets('5 3rd dozen')).toEqual([{ amount: '5', spot: '3rd12' }])
    expect(bets('5 low')).toEqual([{ amount: '5', spot: 'low' }])
  })

  it('reads amounts as the bet box does', () => {
    expect(bets('2.5k black')).toEqual([{ amount: '2.5k', spot: 'black' }])
    expect(bets('1,000 even')).toEqual([{ amount: '1,000', spot: 'even' }])
    expect(bets('half 1st')).toEqual([{ amount: 'half', spot: 'col1' }])
    expect(bets('max 0')).toEqual([{ amount: 'max', spot: '0' }])
    expect(bets('.5 red')).toEqual([{ amount: '.5', spot: 'red' }])
  })

  it('accepts the place first when only that reading works', () => {
    expect(bets('red 50')).toEqual([{ amount: '50', spot: 'red' }])
    expect(bets('2nd all')).toEqual([{ amount: 'all', spot: 'col2' }])
    // "17 50": 50 is not on the wheel, so this is 50 on 17.
    expect(bets('17 50')).toEqual([{ amount: '50', spot: '17' }])
    // "17 20" follows the documented order: 17 on 20.
    expect(bets('17 20')).toEqual([{ amount: '17', spot: '20' }])
  })

  it('takes several bets in one line', () => {
    expect(bets('50 red, 10 17; 5 0')).toEqual([
      { amount: '50', spot: 'red' },
      { amount: '10', spot: '17' },
      { amount: '5', spot: '0' },
    ])
    expect(bets('1,000 red, 2,000 black')).toEqual([
      { amount: '1,000', spot: 'red' },
      { amount: '2,000', spot: 'black' },
    ])
  })

  it('hands back a lone amount, and a place without one, for the command to ask about', () => {
    expect(parseQuickBet('25')).toEqual({ ok: true, bets: [], amount: '25' })
    expect(parseQuickBet('2.5k')).toEqual({ ok: true, bets: [], amount: '2.5k' })
    expect(bets('red')).toEqual([{ amount: null, spot: 'red' }])
    expect(bets('2nd')).toEqual([{ amount: null, spot: 'col2' }])
  })

  it('explains what it cannot read, in plain words', () => {
    expect(error('')).toMatch(/Type a bet/)
    expect(error('all')).toBe('Say where it goes, like "all red".')
    expect(error('50 00')).toMatch(/single zero/)
    expect(error('50 37')).toMatch(/37 is not on the wheel/)
    expect(error('50 purple')).toMatch(/"purple" is not a place on the table/)
    expect(error('lots red')).toMatch(/Type an amount and a place/)
    // A typed bet takes one space (spec).
    for (const combo of ['50 17-20', '50 17/18', '50 13-14-15', '50 1-2-4-5', '50 0-1-2-3']) {
      expect(error(combo), combo).toMatch(
        /takes one space, not a split, street, corner or six line/,
      )
    }
  })

  it('reads a lone place', () => {
    expect(parseSpace('17')).toEqual({ ok: true, spot: '17' })
    expect(parseSpace('07')).toEqual({ ok: true, spot: '7' })
    expect(parseSpace('Black!')).toEqual({ ok: true, spot: 'black' })
    expect(parseSpace('99').ok).toBe(false)
  })
})

describe('the .roulette command', () => {
  const read = (args: string) => readBets(args, '.roulette')

  it('reads one bet or several, each with its amount', () => {
    expect(read('50 red')).toEqual({ ok: true, bets: [{ amount: '50', spot: 'red' }] })
    expect(read('50 red, 25 17')).toEqual({
      ok: true,
      bets: [
        { amount: '50', spot: 'red' },
        { amount: '25', spot: '17' },
      ],
    })
  })

  it('gives a place without an amount the one before it', () => {
    expect(read('50 red, 17, 10 odd, even')).toEqual({
      ok: true,
      bets: [
        { amount: '50', spot: 'red' },
        { amount: '50', spot: '17' },
        { amount: '10', spot: 'odd' },
        { amount: '10', spot: 'even' },
      ],
    })
    expect(withAmounts([{ amount: null, spot: 'red' }])).toBeNull()
  })

  it('says what is missing, with the word as typed', () => {
    expect(read('')).toEqual({
      ok: false,
      error: '.roulette needs a bet and a place, like .roulette 50 red.',
    })
    expect(read('25')).toEqual({ ok: false, error: 'Say where it goes, like .roulette 25 red.' })
    expect(read('red')).toEqual({
      ok: false,
      error: 'Say how much goes on Red, like .roulette 50 red.',
    })
    expect(read('2nd, 50 red')).toEqual({
      ok: false,
      error: 'Say how much goes on 2nd column, like .roulette 50 col2.',
    })
    expect(readBets('50 purple', '.rl')).toMatchObject({
      ok: false,
      error: /"purple" is not a place/,
    })
    // What it suggests reads back as a bet.
    expect(read('50 col2').ok).toBe(true)
  })
})

describe("the endpoints' input", () => {
  it('takes one to every spot, each with typed text, and nothing else', () => {
    expect(RouletteBetInput.safeParse({ bets: [{ spot: 'red', bet: '50' }] }).success).toBe(true)
    expect(RouletteBetInput.safeParse({ bets: [] }).success).toBe(false)
    expect(RouletteBetInput.safeParse({ bets: [{ spot: 'purple', bet: '50' }] }).success).toBe(
      false,
    )
    // The server picks the round: a bet names no spin.
    expect(
      RouletteBetInput.safeParse({ spin: 4, bets: [{ spot: 'red', bet: '50' }] }).success,
    ).toBe(false)
    expect(
      RouletteBetInput.safeParse({ bets: [{ spot: 'red', bet: '50', payout: 9 }] }).success,
    ).toBe(false)
  })

  it('settles a round by its id alone', () => {
    expect(RouletteSettleInput.safeParse({ table: 7 }).success).toBe(true)
    expect(RouletteSettleInput.safeParse({ table: 0 }).success).toBe(false)
    expect(RouletteSettleInput.safeParse({ table: 7, number: 17 }).success).toBe(false)
  })
})

describe('resolving typed bets against the wallet', () => {
  const limits = { minBet: 1n, maxBetPct: 10_000 }

  it('resolves each bet against what is left once the ones before it are down', () => {
    const resolved = resolveBets(
      [
        { spot: 'black', bet: '10' },
        { spot: 'red', bet: 'all' },
      ],
      100n,
      limits,
    )
    expect(resolved).toEqual({
      ok: true,
      bets: [
        { spot: 'black', amount: 10n },
        { spot: 'red', amount: 90n },
      ],
      total: 100n,
    })
    const halves = resolveBets(
      [
        { spot: 'odd', bet: 'half' },
        { spot: 'even', bet: 'half' },
      ],
      100n,
      limits,
    )
    expect(halves.ok && halves.bets.map((b) => b.amount)).toEqual([50n, 25n])
  })

  it('holds every bet to the limits, naming the place when there are several', () => {
    expect(resolveBets([{ spot: 'red', bet: '0.5' }], 100n, limits)).toEqual({
      ok: false,
      error: 'The smallest bet is 1.',
    })
    expect(
      resolveBets(
        [
          { spot: 'red', bet: '60' },
          { spot: '17', bet: '60' },
        ],
        100n,
        limits,
      ),
    ).toEqual({ ok: false, error: '17: You only have 40 chips.' })
    const capped = resolveBets([{ spot: 'red', bet: '60' }], 100n, {
      minBet: 1n,
      maxBetPct: 5_000,
    })
    expect(capped.ok).toBe(false)
    expect(resolveBets([{ spot: 'red', bet: 'all' }], 0n, limits)).toEqual({
      ok: false,
      error: 'Your wallet is empty.',
    })
  })
})
