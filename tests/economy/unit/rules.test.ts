/**
 * The economy's pure rules (spec: Economy): rank income and its cap, the
 * streak, unlock days, the three buttons' draws and what they earn, the
 * challenge pool and progress, chat drop shares and timing, and the flavor
 * line pools.
 */
import { describe, expect, it } from 'vitest'

import { CHIP } from '../../../shared/chips.ts'
import { CONFIG, configDefaults, parseConfigValue } from '../../../shared/config.ts'
import {
  accruedIncome,
  accruedIncomeShown,
  type ChallengeRound,
  type ChallengeSpec,
  challengePool,
  challengeProgress,
  challengeReward,
  commandSettings,
  describeChallenge,
  describeProgress,
  drawPress,
  dropDelaySeconds,
  dropFromMeta,
  dropShare,
  expectedPerHour,
  expectedPerPress,
  flavorLines,
  carryAtRate,
  incomeCarryMs,
  incomeFullInMs,
  nextChipInMs,
  nextTier,
  parseChallengeId,
  pickChallenges,
  rangeCount,
  rangeValue,
  streakBonus,
  streakDays,
  streakMaxDay,
  streakMilestone,
  tierLadder,
  tierUnlocksAt,
} from '../../../shared/features/economy.ts'
import { finalDayStartsAt, medal } from '../../../shared/features/season.ts'
import { gameDay, gameDayStart } from '../../../shared/game-day.ts'
import { waitText } from '../../../server/features/economy/actions.ts'
import { finalDayText, podiumText } from '../../../server/features/season/lifecycle.ts'
import { chance, randomBelow } from '../../../server/lib/rng.ts'

const config = configDefaults()
const HOUR = 3_600_000n

describe('rank income', () => {
  it('builds at the daily rate, rounded down to a whole chip, and stops at 24 hours', () => {
    const base = 5n * CHIP
    expect(accruedIncome(base, 24n * HOUR, 24)).toBe(5n)
    // 2.5 chips so far: 2 are paid.
    expect(accruedIncome(base, 12n * HOUR, 24)).toBe(2n)
    // 5 chips a day is a chip every 4.8 hours.
    expect(accruedIncome(base, 17_279_999n, 24)).toBe(0n)
    expect(accruedIncome(base, 17_280_000n, 24)).toBe(1n)
    expect(accruedIncome(base, 72n * HOUR, 24)).toBe(5n)
    expect(accruedIncome(1_000_000n * CHIP, 30n * HOUR, 24)).toBe(1_000_000n * CHIP)
    expect(accruedIncome(base, -5n, 24)).toBe(0n)
    expect(accruedIncome(0n, 5n * HOUR, 24)).toBe(0n)
  })

  it('carries the part of a chip still building over to the next collect', () => {
    const base = 5n * CHIP
    // 12 hours paid 2 chips, which took 9.6 hours: 2.4 hours (half a chip) carry over.
    expect(incomeCarryMs(base, 12n * HOUR, 24, 2n)).toBe(8_640_000n)
    // Nothing paid yet: all of it carries.
    expect(incomeCarryMs(base, 17_279_999n, 24, 0n)).toBe(17_279_999n)
    // Time past the cap is lost, as the cap says.
    expect(incomeCarryMs(base, 72n * HOUR, 24, 5n)).toBe(0n)
    expect(incomeCarryMs(0n, 5n * HOUR, 24, 0n)).toBe(0n)
    // A chip at 7 a day takes 12,342,857.14... ms: the carry rounds the used time
    // up, so it never pays the same part of a chip twice.
    expect(incomeCarryMs(7n, 12_342_858n, 24, accruedIncome(7n, 12_342_858n, 24))).toBe(0n)

    // Four collects 3 hours apart pay what one collect after 12 hours would.
    let carry = 0n
    let paid = 0n
    for (let i = 0; i < 4; i++) {
      const elapsed = carry + 3n * HOUR
      const income = accruedIncome(base, elapsed, 24)
      carry = incomeCarryMs(base, elapsed, 24, income)
      paid += income
    }
    expect(paid).toBe(accruedIncome(base, 12n * HOUR, 24))
    expect(carry).toBe(8_640_000n)
  })

  it('keeps what was building when a rank is bought, at the new rate', () => {
    // Half a chip at 5 a day (2.4 hours) is half a chip at 15 a day (48 minutes).
    expect(carryAtRate(8_640_000n, 5n, 15n)).toBe(2_880_000n)
    expect(accruedIncome(15n, 2_880_000n, 24)).toBe(0n)
    expect(carryAtRate(0n, 5n, 15n)).toBe(0n)
    expect(carryAtRate(8_640_000n, 5n, 0n)).toBe(0n)
  })

  it('says when the next whole chip comes, until the cap stops it', () => {
    expect(nextChipInMs(5, 0, 24)).toBe(17_280_000)
    expect(nextChipInMs(5, 17_280_000, 24)).toBe(17_280_000)
    expect(nextChipInMs(5, 20 * 3_600_000, 24)).toBe(4 * 3_600_000)
    expect(nextChipInMs(5, 24 * 3_600_000, 24)).toBeNull()
    expect(nextChipInMs(0, 0, 24)).toBeNull()
  })

  it('ticks the same in the browser as the server pays', () => {
    for (const perDay of [5, 15, 1_500]) {
      for (const ms of [0, 1, 17_279_999, 17_280_000, 43_210_987, 86_400_000, 90_000_000]) {
        expect(accruedIncomeShown(perDay, ms, 24)).toBe(
          Number(accruedIncome(BigInt(perDay), BigInt(ms), 24)),
        )
      }
    }
    expect(incomeFullInMs(20 * 3_600_000, 24)).toBe(4 * 3_600_000)
    expect(incomeFullInMs(30 * 3_600_000, 24)).toBe(0)
  })

  it('has seven ranks in order, each paying more than the last', () => {
    const ladder = tierLadder(config, new Date('2026-12-01T15:00:00Z'))
    expect(
      ladder.map((t) => [t.tier, Number(t.price / CHIP), Number(t.perDay / CHIP), t.unlockDay]),
    ).toEqual([
      ['base', 0, 5, 0],
      ['bronze', 150, 15, 1],
      ['silver', 1_000, 100, 3],
      ['gold', 10_000, 1_000, 6],
      ['platinum', 100_000, 10_000, 10],
      ['diamond', 1_000_000, 100_000, 14],
      ['crown', 10_000_000, 1_000_000, 18],
    ])
    expect(nextTier('base')).toBe('bronze')
    expect(nextTier('diamond')).toBe('crown')
    expect(nextTier('crown')).toBeNull()
  })

  it('unlocks a rank at the 4 AM Central reset that starts its season day', () => {
    // The season starts at 9 AM Central on Dec 1 (15:00 UTC).
    const start = new Date('2026-12-01T15:00:00Z')
    expect(gameDay(start)).toBe('2026-12-01')
    // Day 1 opened at 4 AM, before the start: Bronze is open from the start.
    expect(tierUnlocksAt(start, 1).toISOString()).toBe(gameDayStart('2026-12-01').toISOString())
    expect(tierUnlocksAt(start, 1) <= start).toBe(true)
    // Day 3 is Dec 3, at 4 AM Central (10:00 UTC in winter).
    expect(tierUnlocksAt(start, 3).toISOString()).toBe('2026-12-03T10:00:00.000Z')
    // A season starting at 2 AM belongs to the previous game day.
    const early = new Date('2026-12-01T08:00:00Z')
    expect(tierUnlocksAt(early, 3).toISOString()).toBe('2026-12-02T10:00:00.000Z')
  })
})

describe('the streak bonus', () => {
  it('grows a chip a day up to 10, and starts over after a missed day', () => {
    const step = config.streak_step
    const max = config.streak_max
    expect(streakDays(null)).toBe(1)
    expect(streakDays({ bonusClaimed: true, streak: 4 })).toBe(5)
    expect(streakDays({ bonusClaimed: false, streak: 4 })).toBe(1)
    expect([1, 2, 9, 10, 11, 40].map((d) => Number(streakBonus(d, step, max)))).toEqual([
      1, 2, 9, 10, 10, 10,
    ])
    expect(streakMaxDay(step, max)).toBe(10)
    expect([9, 10, 11, 19, 20, 30].map((d) => streakMilestone(d, step, max))).toEqual([
      false,
      true,
      false,
      false,
      true,
      true,
    ])
    expect(streakMilestone(5, 0n, max)).toBe(false)
  })
})

describe('work, slut and crime', () => {
  const always = { chance: () => true, below: (n: number) => n - 1 }
  const never = { chance: () => false, below: () => 0 }

  it('draws a whole number of chips from a range', () => {
    expect(rangeCount(2n, 6n)).toBe(5n)
    expect([0n, 1n, 4n, 9n].map((i) => rangeValue(2n, 6n, i))).toEqual([2n, 3n, 6n, 6n])
    expect(rangeCount(150n, 250n)).toBe(101n)
    expect(rangeValue(150n, 250n, 7n)).toBe(157n)
    expect(rangeCount(5n, 5n)).toBe(1n)
  })

  it('pays from the top of the range or fines from the bottom, and a fine stops at the wallet', () => {
    const crime = commandSettings(config, 'crime')
    expect(drawPress(crime, 0n, always)).toEqual({ paid: true, drawn: 150n, amount: 150n })
    expect(drawPress(crime, 50n, never)).toEqual({ paid: false, drawn: 10n, amount: 10n })
    expect(drawPress(crime, 4n, never)).toEqual({ paid: false, drawn: 10n, amount: 4n })
    expect(drawPress(crime, 0n, never)).toEqual({ paid: false, drawn: 10n, amount: 0n })
    // Work cannot fail.
    const work = commandSettings(config, 'work')
    expect(work.successPct).toBe(10_000)
    expect(work.fineMax).toBe(0n)
  })

  it('earns what the spec intends: work most per hour, the others most per press', () => {
    const [work, hustle, crime] = (['work', 'hustle', 'crime'] as const).map((c) =>
      commandSettings(config, c),
    ) as [
      ReturnType<typeof commandSettings>,
      ReturnType<typeof commandSettings>,
      ReturnType<typeof commandSettings>,
    ]
    // 4, 19.25 and 36.25 chips a press.
    expect(expectedPerPress(work)).toBe(4)
    expect(expectedPerPress(hustle)).toBeCloseTo(19.25)
    expect(expectedPerPress(crime)).toBeCloseTo(36.25)
    expect(expectedPerHour(work)).toBe(48)
    expect(expectedPerHour(hustle)).toBeCloseTo(19.25)
    expect(expectedPerHour(crime)).toBeCloseTo(18.125)
    expect(expectedPerHour(work)).toBeGreaterThan(expectedPerHour(hustle))
    expect(expectedPerPress(crime)).toBeGreaterThan(expectedPerPress(hustle))
    expect(expectedPerPress(hustle)).toBeGreaterThan(expectedPerPress(work))
  })

  it("draws with the server's randomness close to the expected value", () => {
    const rng = { chance, below: randomBelow }
    for (const command of ['work', 'hustle', 'crime'] as const) {
      const settings = commandSettings(config, command)
      const presses = 40_000
      let total = 0
      let paid = 0
      for (let i = 0; i < presses; i++) {
        const press = drawPress(settings, 1_000_000n, rng)
        total += Number(press.paid ? press.amount : -press.amount)
        if (press.paid) paid++
        if (press.paid) {
          expect(press.amount).toBeGreaterThanOrEqual(settings.payMin)
          expect(press.amount).toBeLessThanOrEqual(settings.payMax)
        }
      }
      expect(paid / presses).toBeCloseTo(settings.successPct / 10_000, 1)
      const mean = total / presses
      const expected = expectedPerPress(settings)
      expect(Math.abs(mean - expected)).toBeLessThan(Math.max(0.4, Math.abs(expected) * 0.05))
    }
  })

  it('says how long to wait in plain words', () => {
    expect(waitText(400)).toBe('1 second')
    expect(waitText(42_000)).toBe('42 seconds')
    expect(waitText(61_000)).toBe('2 minutes')
    expect(waitText(60_000)).toBe('1 minute')
    expect(waitText(3_600_000)).toBe('1 hour')
    expect(waitText(5_340_000)).toBe('1 hour and 29 minutes')
    expect(waitText(7_260_000)).toBe('2 hours and 1 minute')
  })
})

describe('the flavor lines', () => {
  const POOLS = {
    work_lines: CONFIG.work_lines.default,
    hustle_win_lines: CONFIG.hustle_win_lines.default,
    hustle_fine_lines: CONFIG.hustle_fine_lines.default,
    crime_win_lines: CONFIG.crime_win_lines.default,
    crime_fine_lines: CONFIG.crime_fine_lines.default,
  } as const

  it('starts with the full pools, every line within the admin panel limits', () => {
    expect(POOLS.work_lines.length).toBeGreaterThanOrEqual(30)
    expect(POOLS.hustle_win_lines.length).toBeGreaterThanOrEqual(40)
    expect(POOLS.hustle_fine_lines.length).toBeGreaterThanOrEqual(30)
    expect(POOLS.crime_win_lines.length).toBeGreaterThanOrEqual(25)
    expect(POOLS.crime_fine_lines.length).toBeGreaterThanOrEqual(25)
    for (const [key, pool] of Object.entries(POOLS)) {
      expect(parseConfigValue(key as keyof typeof POOLS, [...pool]).ok, key).toBe(true)
      expect(new Set(pool).size, `${key} repeats a line`).toBe(pool.length)
      for (const line of pool) {
        expect(line.length, line).toBeLessThanOrEqual(120)
        expect(line, line).toMatch(/[.!?]$/)
      }
    }
  })

  it("uses the admin's lines once edited, and the starting pool if the list is emptied", () => {
    expect(flavorLines(config, 'hustle_win_lines')).toBe(config.hustle_win_lines)
    const edited = { ...config, hustle_win_lines: ['You won the lottery.'] }
    expect(flavorLines(edited, 'hustle_win_lines')).toEqual(['You won the lottery.'])
    const emptied = { ...config, crime_fine_lines: [] }
    expect(flavorLines(emptied, 'crime_fine_lines')).toBe(POOLS.crime_fine_lines)
  })
})

describe('challenges', () => {
  const round = (
    game: string,
    stake: number,
    payout: number,
    extra: Partial<ChallengeRound> = {},
  ) => ({
    game,
    stake,
    payout,
    multiplier: Math.round((payout / stake) * 100),
    allIn: false,
    ...extra,
  })

  it('only asks for what this season has made possible', () => {
    const empty = challengePool({ games: [] })
    expect(empty.every((c) => c.game === null)).toBe(true)
    expect(empty.some((c) => c.metric === 'games' || c.metric === 'bestMultiplier')).toBe(false)

    const pool = challengePool({
      games: [
        { game: 'coinflip', bestMultiplier: 196 },
        { game: 'roulette', bestMultiplier: 3_600 },
      ],
    })
    const ids = pool.map((c) => c.id)
    expect(ids).toContain('games-2')
    expect(ids).not.toContain('games-3')
    expect(ids).toContain('bestMultiplier-300')
    expect(ids).toContain('bestMultiplier-1000')
    expect(ids).toContain('wins-3-coinflip')
    expect(ids).toContain('bestMultiplier-1000-roulette')
    expect(ids).not.toContain('bestMultiplier-300-coinflip')
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of pool)
      expect(parseChallengeId(c.id)).toEqual({
        id: c.id,
        metric: c.metric,
        target: c.target,
        game: c.game,
      })
  })

  it('picks easy, medium and hard, never two of the same kind in the same game', () => {
    const pool = challengePool({ games: [{ game: 'coinflip', bestMultiplier: 196 }] })
    for (let seed = 0; seed < 50; seed++) {
      let n = seed
      const picked = pickChallenges(pool, 3, (size) => n++ % size)
      expect(picked.map((c) => c.level)).toEqual([1, 2, 3])
      const kinds = picked.map((c) => `${c.metric}|${c.game}`)
      expect(new Set(kinds).size).toBe(3)
    }
    expect(pickChallenges([], 3, () => 0)).toEqual([])
  })

  it('pays more for harder ones', () => {
    const [min, max] = [config.challenge_reward_min, config.challenge_reward_max]
    expect([1, 2, 3].map((l) => challengeReward(l as 1 | 2 | 3, min, max))).toEqual([2n, 3n, 4n])
    expect(challengeReward(2, 150n, 400n)).toBe(275n)
    // 3.5 rounds down to a whole chip.
    expect(challengeReward(2, 2n, 5n)).toBe(3n)
  })

  it("measures each kind from the day's settled rounds", () => {
    const rounds = [
      round('coinflip', 100, 196),
      round('coinflip', 100, 196),
      round('roulette', 100, 0),
      round('coinflip', 100, 196),
      round('roulette', 50, 1_800),
      round('coinflip', 500, 980, { allIn: true }),
      round('roulette', 100, 100),
    ]
    const at = (id: string): ChallengeSpec => {
      const parsed = parseChallengeId(id)
      if (!parsed) throw new Error(id)
      return { ...parsed, level: 1 }
    }
    expect(challengeProgress(at('rounds-10'), rounds)).toBe(7)
    expect(challengeProgress(at('rounds-5-roulette'), rounds)).toBe(3)
    // A push pays back the stake: not a win.
    expect(challengeProgress(at('wins-15'), rounds)).toBe(5)
    expect(challengeProgress(at('wins-3-coinflip'), rounds)).toBe(3)
    expect(challengeProgress(at('games-3'), rounds)).toBe(2)
    expect(challengeProgress(at('winStreak-3'), rounds)).toBe(3)
    expect(challengeProgress(at('bestMultiplier-1000'), rounds)).toBe(1_000)
    expect(challengeProgress(at('bestMultiplier-300-coinflip'), rounds)).toBe(196)
    expect(challengeProgress(at('allInWins-1'), rounds)).toBe(1)
  })

  it('reads well', () => {
    const c = (id: string) => ({ ...(parseChallengeId(id) as ChallengeSpec), level: 1 as const })
    expect(describeChallenge(c('rounds-10'))).toBe('Play 10 rounds')
    expect(describeChallenge(c('rounds-5-roulette'), 'Roulette')).toBe('Play Roulette 5 times')
    expect(describeChallenge(c('wins-3-blackjack'), 'Blackjack')).toBe('Win at Blackjack 3 times')
    expect(describeChallenge(c('games-3'))).toBe('Play 3 different games')
    expect(describeChallenge(c('winStreak-3'))).toBe('Win 3 rounds in a row')
    expect(describeChallenge(c('bestMultiplier-300-crash'), 'Crash')).toBe(
      'Win 3x or more at Crash',
    )
    expect(describeChallenge(c('bestMultiplier-1000'))).toBe('Win a round paying 10x or more')
    expect(describeChallenge(c('allInWins-1'))).toBe('Win an all-in bet')
    expect(describeProgress(c('wins-3'), 2)).toBe('2 of 3')
    expect(describeProgress(c('bestMultiplier-300'), 196)).toBe('Best 1.96x of 3x')
    expect(describeProgress(c('bestMultiplier-300'), 300)).toBe('3x reached')
    expect(describeProgress(c('bestMultiplier-300'), 0)).toBe('Not yet')
  })
})

describe('chat drops', () => {
  it('splits the pot evenly, rounded down to a whole chip', () => {
    expect(dropShare(10n, 3)).toBe(3n)
    expect(dropShare(10n, 1)).toBe(10n)
    expect(dropShare(10n, 0)).toBe(0n)
    expect(dropShare(0n, 3)).toBe(0n)
  })

  it('lands between half and one and a half times the average apart', () => {
    expect(dropDelaySeconds(90, () => 0)).toBe(2_700)
    expect(dropDelaySeconds(90, (n) => n - 1)).toBe(8_100)

    // Every possible draw once, in turn, so the average is exact. An average
    // of real random draws misses by chance now and then (about 1 run in 150
    // for 20,000 draws held to half a minute).
    let next = 0
    let span = 1
    const inTurn = (n: number) => {
      span = n
      return next++
    }
    let total = 0
    do {
      total += dropDelaySeconds(90, inTurn)
    } while (next < span)
    expect(total / span / 60).toBe(90)

    // Real draws stay in that range.
    for (let i = 0; i < 1_000; i++) {
      const delay = dropDelaySeconds(90, randomBelow)
      expect(delay).toBeGreaterThanOrEqual(2_700)
      expect(delay).toBeLessThanOrEqual(8_100)
    }
  })

  it('reads a drop back from its chat post', () => {
    expect(dropFromMeta({ tone: 'win', drop: { id: 4, pot: 10, winners: 3, share: 3 } })).toEqual({
      id: 4,
      pot: 10,
      winners: 3,
      share: 3,
    })
    expect(dropFromMeta({ tone: 'win' })).toBeNull()
    expect(dropFromMeta(null)).toBeNull()
    expect(dropFromMeta({ drop: { id: 'x' } })).toBeNull()
  })
})

describe('the end of a season', () => {
  it('starts the final day 24 hours before the end', () => {
    const end = new Date('2026-12-31T06:00:00Z')
    expect(finalDayStartsAt(end, 24).toISOString()).toBe('2026-12-30T06:00:00.000Z')
  })

  it('posts the podium with medals', () => {
    expect(medal(1)).toBe('🥇')
    expect(medal(4)).toBeNull()
    expect(
      podiumText('December', [
        { rank: 1, userId: 'a', displayName: 'Ava', netWorth: 12_345n },
        { rank: 2, userId: 'b', displayName: 'Ben', netWorth: 999n },
      ]),
    ).toBe('🏁 December is over! 🥇 Ava 12,345 · 🥈 Ben 999. Every place is in the Hall of Fame.')
    expect(podiumText('Empty', [])).toBe('🏁 Empty is over.')
  })

  it('says how much of the final day is left when its post goes up', () => {
    const left = (ms: number) => finalDayText('May', ms).split(': ')[1]?.split(' to go')[0]
    expect(left(24 * 3_600_000 - 50)).toBe('24 hours')
    expect(left(12 * 3_600_000 + 20 * 60_000)).toBe('12 hours')
    expect(left(2 * 3_600_000 - 10 * 60_000)).toBe('2 hours')
    expect(left(80 * 60_000)).toBe('about an hour')
    expect(left(45 * 60_000)).toBe('about an hour')
    expect(left(40 * 60_000)).toBe('40 minutes')
    expect(left(20_000)).toBe('1 minute')
  })
})
