/**
 * The heist rules the browser and the server share (spec: Steal, shields and
 * vault): the steal rate by rank gap, the spec's worked example, the daily
 * loss cap, fines, prices, the vault's room, season weeks, the order in which
 * a target is refused, and the words a player sees.
 */
import { describe, expect, it } from 'vitest'

import { chips } from '../../../shared/chips.ts'
import { configDefaults } from '../../../shared/config.ts'
import {
  attemptsAllowed,
  BLOCK_LABELS,
  blockMessage,
  capLeft,
  checkTarget,
  dailyLossCap,
  extraAttemptPrice,
  rateLabel,
  seasonWeek,
  shieldPrice,
  StealInput,
  stealAmount,
  stealFine,
  stealRate,
  TARGET_BLOCKS,
  parseVaultAmount,
  type TargetFacts,
  vaultMost,
  VaultMoveInput,
  vaultMoveProblem,
  vaultRoom,
} from '../../../shared/features/heist.ts'
import { gameDayStart } from '../../../shared/game-day.ts'

const cfg = configDefaults()

describe('the steal rate', () => {
  it('starts at the base rate and adds a step for each rank the target is ahead', () => {
    expect(stealRate(0, cfg)).toBe(150)
    expect(stealRate(1, cfg)).toBe(180)
    expect(stealRate(5, cfg)).toBe(300)
    expect(stealRate(8, cfg)).toBe(390)
  })

  it('never passes the maximum', () => {
    expect(stealRate(9, cfg)).toBe(400)
    expect(stealRate(40, cfg)).toBe(400)
  })

  it('takes the down rate from anyone ranked below the thief', () => {
    expect(stealRate(-1, cfg)).toBe(50)
    expect(stealRate(-9, cfg)).toBe(50)
  })

  it('reads its numbers from config', () => {
    const rates = {
      steal_base_rate: 100,
      steal_per_rank: 50,
      steal_max_rate: 250,
      steal_down_rate: 10,
    }
    expect(stealRate(2, rates)).toBe(200)
    expect(stealRate(4, rates)).toBe(250)
    expect(stealRate(-2, rates)).toBe(10)
  })

  it('labels the rate for the odds line', () => {
    expect(rateLabel(180)).toBe('1.8% of their wallet')
    expect(rateLabel(400)).toBe('4% of their wallet')
  })
})

describe('the spec’s worked example', () => {
  // 10th with 4,000 chips robs the leader, who has 60,000 in the wallet and nothing in the vault.
  const leaderWallet = chips(60_000)
  const thiefWallet = chips(4_000)

  it('takes 2,400 chips on a success, which is also the leader’s whole daily cap', () => {
    const rate = stealRate(10 - 1, cfg)
    expect(rate).toBe(400)
    const left = capLeft(leaderWallet, 0n, cfg.daily_loss_cap_pct)
    expect(left).toBe(chips(2_400))
    const amount = stealAmount(leaderWallet, rate, left)
    expect(amount).toBe(chips(2_400))
    // The thief gains 60%, the leader loses 4% and has hit the cap.
    expect((amount * 100n) / thiefWallet).toBe(60n)
    expect(capLeft(leaderWallet, amount, cfg.daily_loss_cap_pct)).toBe(0n)
  })

  it('costs the thief 200 chips on a failure', () => {
    expect(stealFine(thiefWallet, cfg.steal_fine_pct)).toBe(chips(200))
  })
})

describe('the daily loss cap and the take', () => {
  it('is a share of net worth at the reset, and nothing for an empty one', () => {
    expect(dailyLossCap(chips(1_000), 400)).toBe(chips(40))
    expect(dailyLossCap(0n, 400)).toBe(0n)
    expect(dailyLossCap(-500n, 400)).toBe(0n)
  })

  it('counts down as chips are stolen, and never below zero', () => {
    expect(capLeft(chips(1_000), chips(15), 400)).toBe(chips(25))
    expect(capLeft(chips(1_000), chips(40), 400)).toBe(0n)
    expect(capLeft(chips(1_000), chips(90), 400)).toBe(0n)
  })

  it('takes the rate of the wallet, rounded down to a hundredth, within what is left of the cap', () => {
    // 1.5% of 1.01 chips is 0.01515 chips: one hundredth.
    expect(stealAmount(101n, 150, chips(10))).toBe(1n)
    expect(stealAmount(chips(600), 180, chips(100))).toBe(1_080n)
    expect(stealAmount(chips(600), 180, 500n)).toBe(500n)
    expect(stealAmount(0n, 180, chips(10))).toBe(0n)
    expect(stealAmount(chips(600), 180, 0n)).toBe(0n)
  })

  it('fines a share of the thief’s own wallet, and nothing from an empty one', () => {
    expect(stealFine(chips(50), 500)).toBe(250n)
    expect(stealFine(333n, 500)).toBe(16n)
    expect(stealFine(0n, 500)).toBe(0n)
  })
})

describe('prices', () => {
  it('charges 2% of the wallet for a shield charge, at least 3 chips', () => {
    expect(shieldPrice(chips(1_000), cfg)).toBe(chips(20))
    expect(shieldPrice(chips(150), cfg)).toBe(chips(3))
    expect(shieldPrice(chips(100), cfg)).toBe(chips(3))
    expect(shieldPrice(0n, cfg)).toBe(chips(3))
    expect(shieldPrice(12_345n, cfg)).toBe(300n)
    expect(shieldPrice(123_456n, cfg)).toBe(2_469n)
  })

  it('prices the extra steal attempt the same way from its own settings', () => {
    expect(extraAttemptPrice(chips(1_000), cfg)).toBe(chips(20))
    expect(extraAttemptPrice(chips(10), cfg)).toBe(chips(3))
    expect(
      extraAttemptPrice(chips(1_000), {
        extra_steal_price_pct: 500,
        extra_steal_price_min: chips(1),
      }),
    ).toBe(chips(50))
  })

  it('counts the extra attempt on top of the free ones', () => {
    expect(attemptsAllowed(2, false)).toBe(2)
    expect(attemptsAllowed(2, true)).toBe(3)
  })
})

describe('the vault’s room', () => {
  it('holds up to a quarter of net worth', () => {
    expect(vaultRoom(chips(1_000), 0n, 2_500)).toBe(chips(250))
    expect(vaultRoom(chips(800), chips(200), 2_500)).toBe(chips(50))
    expect(vaultRoom(chips(750), chips(250), 2_500)).toBe(0n)
  })

  it('has no room once losses leave the vault above the cap', () => {
    expect(vaultRoom(chips(100), chips(250), 2_500)).toBe(0n)
  })

  it('can never take more than the wallet holds', () => {
    expect(vaultRoom(chips(100), 0n, 10_000)).toBe(chips(100))
    expect(vaultRoom(0n, chips(50), 10_000)).toBe(0n)
  })

  it('rounds down to a hundredth', () => {
    expect(vaultRoom(101n, 0n, 2_500)).toBe(25n)
  })
})

describe('season weeks', () => {
  const start = gameDayStart('2026-12-01')

  it('runs seven game days from the season’s first', () => {
    const first = seasonWeek(start, new Date(start.getTime() + 3_600_000))
    expect(first.index).toBe(0)
    expect(first.start).toEqual(start)
    expect(first.end).toEqual(gameDayStart('2026-12-08'))

    const lastMinute = seasonWeek(start, new Date(gameDayStart('2026-12-08').getTime() - 1))
    expect(lastMinute.index).toBe(0)

    const second = seasonWeek(start, gameDayStart('2026-12-08'))
    expect(second.index).toBe(1)
    expect(second.start).toEqual(gameDayStart('2026-12-08'))
    expect(second.end).toEqual(gameDayStart('2026-12-15'))
  })

  it('counts from the game day a season starts in, even when it starts mid-day', () => {
    const midday = new Date(gameDayStart('2026-12-01').getTime() + 9 * 3_600_000)
    const week = seasonWeek(midday, new Date(gameDayStart('2026-12-07').getTime() + 1))
    expect(week).toMatchObject({ index: 0, end: gameDayStart('2026-12-08') })
  })

  it('stays on the first week before the season starts', () => {
    expect(seasonWeek(start, new Date(start.getTime() - 86_400_000)).index).toBe(0)
  })
})

describe('who can be robbed', () => {
  const now = Date.parse('2026-12-03T18:00:00Z')

  function facts(overrides: Partial<TargetFacts> = {}): TargetFacts {
    return {
      phase: 'open',
      thief: { id: 'thief', rank: 4 },
      target: { id: 'target', rank: 1, balance: chips(600), netWorth: chips(600) },
      attemptsLeft: 2,
      triedToday: false,
      immuneUntil: null,
      now,
      capLeft: chips(24),
      cfg,
      ...overrides,
    }
  }

  it('says what a success would take', () => {
    expect(checkTarget(facts())).toEqual({ ok: true, gap: 3, rate: 240, amount: 1_440n })
  })

  it('limits the take to what is left of the cap', () => {
    expect(checkTarget(facts({ capLeft: 900n }))).toMatchObject({ ok: true, amount: 900n })
  })

  it('refuses for each reason the spec lists', () => {
    const cases: [Partial<TargetFacts>, string][] = [
      [{ phase: null }, 'no_season'],
      [{ phase: 'upcoming' }, 'no_season'],
      [{ phase: 'over' }, 'no_season'],
      [{ phase: 'final_day' }, 'freeze'],
      [{ target: { id: 'thief', rank: 4, balance: chips(100), netWorth: chips(100) } }, 'self'],
      [{ target: null }, 'unknown'],
      [{ attemptsLeft: 0 }, 'no_attempts'],
      [{ triedToday: true }, 'tried'],
      [{ immuneUntil: now + 60_000 }, 'immune'],
      [{ target: { id: 'target', rank: 1, balance: chips(24), netWorth: chips(24) } }, 'floor'],
      [{ capLeft: 0n }, 'cap'],
      [{ target: { id: 'target', rank: 1, balance: 0n, netWorth: chips(500) } }, 'empty'],
    ]
    for (const [override, reason] of cases) {
      expect(checkTarget(facts(override)), reason).toEqual({ ok: false, reason })
    }
  })

  it('lets immunity lapse at its exact end', () => {
    expect(checkTarget(facts({ immuneUntil: now })).ok).toBe(true)
    expect(checkTarget(facts({ immuneUntil: now - 1 })).ok).toBe(true)
  })

  it('counts the floor on net worth, so chips in the vault keep a player robbable', () => {
    const vaulted = { id: 'target', rank: 1, balance: chips(20), netWorth: chips(30) }
    expect(checkTarget(facts({ target: vaulted }))).toMatchObject({ ok: true })
  })

  it('names the most general reason first', () => {
    const everything = facts({
      phase: 'final_day',
      attemptsLeft: 0,
      triedToday: true,
      immuneUntil: now + 1,
      capLeft: 0n,
    })
    expect(checkTarget(everything)).toEqual({ ok: false, reason: 'freeze' })
    expect(checkTarget({ ...everything, phase: 'open' })).toEqual({
      ok: false,
      reason: 'no_attempts',
    })
    expect(checkTarget({ ...everything, phase: 'open', attemptsLeft: 1 })).toEqual({
      ok: false,
      reason: 'tried',
    })
    expect(
      checkTarget({ ...everything, phase: 'open', attemptsLeft: 1, triedToday: false }),
    ).toEqual({
      ok: false,
      reason: 'immune',
    })
  })
})

describe('the words a player sees', () => {
  it('explains every refusal in plain words', () => {
    const context = {
      name: 'Bob',
      freezeHours: 24,
      floor: chips(25),
      immuneFor: '2h 5m',
      canBuyExtra: true,
    }
    expect(TARGET_BLOCKS.map((reason) => blockMessage(reason, context))).toEqual([
      'Steals open when the season is running.',
      'Steals are off for the final 24 hours of the season.',
      'You cannot rob yourself.',
      'That player is not in this season.',
      'You have no steal attempts left today. Buy one more in the Shop, or wait for 4:00 AM.',
      'You already tried to rob Bob today.',
      'Bob is immune for 2h 5m after the last steal.',
      'Bob has under 25 chips net worth, too little to rob.',
      'Bob has lost all they can to steals today.',
      'Bob has nothing in their wallet to take.',
    ])
  })

  it('points to the reset once the extra attempt is used', () => {
    expect(blockMessage('no_attempts', { canBuyExtra: false })).toBe(
      'You have no steal attempts left today. More at 4:00 AM Central.',
    )
  })

  it('has a short label for each reason', () => {
    for (const reason of TARGET_BLOCKS) expect(BLOCK_LABELS[reason].length).toBeLessThanOrEqual(14)
  })
})

describe('what the endpoints accept', () => {
  it('takes a target id and nothing else for a steal', () => {
    expect(StealInput.safeParse({ targetId: '6f1d2c3b-4a59-4e68-8b7a-9c0d1e2f3a4b' }).success).toBe(
      true,
    )
    const bad = StealInput.safeParse({ targetId: 'bob' })
    expect(bad.success).toBe(false)
    expect(bad.error?.issues[0]?.message).toBe('Pick a player to rob.')
    expect(
      StealInput.safeParse({ targetId: '6f1d2c3b-4a59-4e68-8b7a-9c0d1e2f3a4b', amount: 5 }).success,
    ).toBe(false)
  })

  it('takes a direction and an amount typed like a bet for a vault move', () => {
    expect(VaultMoveInput.parse({ direction: 'deposit', amount: ' 2.5k ' })).toEqual({
      direction: 'deposit',
      amount: '2.5k',
    })
    expect(VaultMoveInput.safeParse({ direction: 'withdraw', amount: 'max' }).success).toBe(true)
    expect(
      VaultMoveInput.safeParse({ direction: 'steal', amount: '5' }).error?.issues[0]?.message,
    ).toBe('Choose deposit or withdraw.')
    expect(VaultMoveInput.safeParse({ direction: 'deposit', amount: '  ' }).success).toBe(false)
    expect(VaultMoveInput.safeParse({ direction: 'deposit', amount: 5 }).success).toBe(false)
  })
})

describe('typed vault amounts', () => {
  const wallet = chips(800)
  const vaultNow = chips(100)

  it('reads max and all as the most this move allows, and half as half of it', () => {
    // A quarter of 900 is 225, and 100 is already in: room for 125 more.
    expect(vaultMost('deposit', wallet, vaultNow, 2_500)).toBe(chips(125))
    expect(vaultMost('withdraw', wallet, vaultNow, 2_500)).toBe(chips(100))
    expect(parseVaultAmount('max', 'deposit', wallet, vaultNow, 2_500)).toEqual({
      ok: true,
      amount: chips(125),
    })
    expect(parseVaultAmount(' All ', 'withdraw', wallet, vaultNow, 2_500)).toEqual({
      ok: true,
      amount: chips(100),
    })
    expect(parseVaultAmount('half', 'deposit', wallet, vaultNow, 2_500)).toEqual({
      ok: true,
      amount: 6_250n,
    })
    expect(parseVaultAmount('half', 'withdraw', wallet, vaultNow, 2_500)).toEqual({
      ok: true,
      amount: chips(50),
    })
  })

  it('reads numbers like the bet box, and explains anything else', () => {
    expect(parseVaultAmount('1.5k', 'deposit', wallet, vaultNow, 2_500)).toEqual({
      ok: true,
      amount: chips(1_500),
    })
    expect(parseVaultAmount('12.505', 'deposit', wallet, vaultNow, 2_500)).toEqual({
      ok: true,
      amount: 1_250n,
    })
    expect(parseVaultAmount('lots', 'deposit', wallet, vaultNow, 2_500)).toEqual({
      ok: false,
      error: '"lots" is not an amount. Try 20, half or max.',
    })
  })

  it('says why a move cannot happen', () => {
    expect(vaultMoveProblem('deposit', chips(100), wallet, vaultNow, 2_500)).toBeNull()
    expect(vaultMoveProblem('deposit', chips(200), wallet, vaultNow, 2_500)).toEqual({
      code: 'vault_full',
      message: 'Your vault can take 125 chips more right now: up to 25% of your net worth.',
    })
    expect(vaultMoveProblem('deposit', chips(900), wallet, vaultNow, 2_500)?.code).toBe(
      'insufficient_funds',
    )
    expect(vaultMoveProblem('withdraw', chips(101), wallet, vaultNow, 2_500)?.message).toBe(
      'Your vault only has 100 chips.',
    )
    expect(vaultMoveProblem('withdraw', 0n, wallet, 0n, 2_500)?.code).toBe('vault_empty')
    expect(vaultMoveProblem('withdraw', 0n, wallet, vaultNow, 2_500)?.code).toBe('zero')
    expect(vaultMoveProblem('deposit', 0n, 0n, vaultNow, 2_500)?.code).toBe('wallet_empty')
    expect(vaultMoveProblem('deposit', 0n, chips(300), chips(100), 2_500)?.code).toBe('vault_full')
  })
})
