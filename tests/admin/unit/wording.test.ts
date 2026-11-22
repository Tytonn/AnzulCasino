/**
 * The admin lane's shared wording and math (spec: Admin panel; Giveaways;
 * Admin and trust): the chat posts and notes every player reads, how a
 * giveaway splits a pot, and the inputs the endpoints accept.
 */
import { describe, expect, it } from 'vitest'

import {
  AdjustInput,
  adjustNoticeText,
  adjustPostText,
  centralWhen,
  ConfigSaveInput,
  EditSeasonInput,
  EndSeasonInput,
  GiveawayInput,
  giveawayNoticeText,
  giveawayPostText,
  giveawayShares,
  MAX_ADMIN_AMOUNT,
  nameList,
  seasonEndPostText,
} from '../../../shared/features/admin.ts'

const ID = '0b5c1a8e-3a7d-4a39-9a51-2f7c8f0d9e11'

describe('giveaway shares', () => {
  it('gives each player the amount, with nothing left over', () => {
    expect(giveawayShares(500n, 4, false)).toEqual({ share: 500n, total: 2000n, leftover: 0n })
  })

  it('splits a pot to the hundredth and never pays out more than it holds', () => {
    // 10 chips between 3: 3.33 each, and 0.01 stays in the pot.
    expect(giveawayShares(1000n, 3, true)).toEqual({ share: 333n, total: 999n, leftover: 1n })
    expect(giveawayShares(1n, 4, true)).toEqual({ share: 0n, total: 0n, leftover: 1n })
  })

  it('gives nothing to nobody', () => {
    expect(giveawayShares(500n, 0, true)).toEqual({ share: 0n, total: 0n, leftover: 500n })
  })
})

describe('names in a sentence', () => {
  it('joins one, two, three and many', () => {
    expect(nameList([])).toBe('nobody')
    expect(nameList(['Alice'])).toBe('Alice')
    expect(nameList(['Alice', 'Bob'])).toBe('Alice and Bob')
    expect(nameList(['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob and Carol')
    expect(nameList(['A', 'B', 'C', 'D', 'E'], 3)).toBe('A, B and 3 others')
  })
})

describe('chat posts and notes', () => {
  it('says who moved whose chips, and why', () => {
    const post = { admin: 'Ada', player: 'Bob', self: false, account: 'wallet' as const }
    expect(adjustPostText({ ...post, amount: 50_000n, reason: 'Refund for the frozen flip' })).toBe(
      "🧾 Ada added 500 chips to Bob's wallet: Refund for the frozen flip",
    )
    expect(adjustPostText({ ...post, amount: -150n, account: 'vault', reason: 'Typo' })).toBe(
      "🧾 Ada took 1.50 chips from Bob's vault: Typo",
    )
    expect(adjustPostText({ ...post, self: true, amount: -100n, reason: 'My own fine' })).toBe(
      '🧾 Ada took 1 chip from their own wallet: My own fine',
    )
    expect(adjustNoticeText('Ada', 100n, 'wallet', 'Birthday')).toBe(
      'Ada added 1 chip to your wallet: Birthday',
    )
    expect(adjustNoticeText('Ada', -250n, 'vault', 'Typo')).toBe(
      'Ada took 2.50 chips from your vault: Typo',
    )
  })

  it('words a giveaway by how it was given', () => {
    const base = { admin: 'Ada', everyone: false, split: false, note: null }
    expect(giveawayPostText({ ...base, names: ['Bob'], amount: 100n, share: 100n })).toBe(
      '🎁 Ada gave Bob 1 chip.',
    )
    expect(
      giveawayPostText({ ...base, names: ['Bob', 'Cy'], amount: 500n, share: 500n, note: 'Hi' }),
    ).toBe('🎁 Ada gave Bob and Cy 5 chips each: Hi')
    expect(
      giveawayPostText({
        ...base,
        everyone: true,
        names: ['A', 'B', 'C'],
        amount: 200n,
        share: 200n,
      }),
    ).toBe('🎁 Ada gave everyone 2 chips.')
    expect(
      giveawayPostText({
        ...base,
        everyone: true,
        split: true,
        names: ['A', 'B', 'C'],
        amount: 1000n,
        share: 333n,
      }),
    ).toBe('🎁 Ada split 10 chips between all 3 players, 3.33 each.')
    expect(giveawayNoticeText('Ada', 333n, 'Happy Friday')).toBe(
      '🎁 Ada gave you 3.33 chips: Happy Friday',
    )
  })

  it('says when a season ends early, in Central time', () => {
    expect(seasonEndPostText({ admin: 'Ada', season: 'Season 2', endsAt: null })).toBe(
      '🛑 Ada ended Season 2 early.',
    )
    const at = new Date('2026-12-01T16:00:00Z')
    expect(centralWhen(at)).toBe('Tue, Dec 1, 10:00 AM CT')
    expect(
      seasonEndPostText({ admin: 'Ada', season: 'Season 2', endsAt: at, reason: 'New rules' }),
    ).toBe('⏱️ Ada moved the end of Season 2 to Tue, Dec 1, 10:00 AM CT: New rules')
  })
})

describe('inputs', () => {
  it('takes an adjustment with a reason, in hundredths', () => {
    const ok = AdjustInput.parse({ userId: ID, amount: -250, reason: '  Typo fix  ' })
    expect(ok).toEqual({ userId: ID, amount: -250, account: 'wallet', reason: 'Typo fix' })
    const refusals = [
      { userId: ID, amount: 0, reason: 'Nothing' },
      { userId: ID, amount: 1.5, reason: 'Half a hundredth' },
      { userId: ID, amount: MAX_ADMIN_AMOUNT + 1, reason: 'Too much' },
      { userId: ID, amount: 100, reason: 'no' },
      { userId: 'bob', amount: 100, reason: 'Not an id' },
      { userId: ID, amount: 100, reason: 'Extra field', extra: true },
    ]
    for (const input of refusals) expect(AdjustInput.safeParse(input).success).toBe(false)
  })

  it('takes a giveaway to everyone or to named players, once each', () => {
    expect(GiveawayInput.parse({ to: 'everyone', amount: 100 })).toEqual({
      to: 'everyone',
      amount: 100,
      split: false,
    })
    expect(GiveawayInput.parse({ to: [ID, ID], amount: 100, note: '' }).to).toEqual([ID])
    expect(GiveawayInput.safeParse({ to: [], amount: 100 }).success).toBe(false)
    expect(GiveawayInput.safeParse({ to: 'everyone', amount: -1 }).success).toBe(false)
  })

  it('takes a season change only when something changes', () => {
    expect(EditSeasonInput.safeParse({}).success).toBe(false)
    expect(EditSeasonInput.parse({ name: ' Winter ' })).toEqual({ name: 'Winter' })
    const end = EndSeasonInput.parse({ at: '2026-12-01T16:00:00Z' })
    expect(end.at).toEqual(new Date('2026-12-01T16:00:00Z'))
    expect(EndSeasonInput.parse({ reason: '' })).toEqual({ reason: undefined })
  })

  it('takes a batch of setting changes', () => {
    expect(ConfigSaveInput.safeParse({ changes: [] }).success).toBe(false)
    expect(
      ConfigSaveInput.safeParse({ changes: [{ key: 'work_pay_max', value: 900 }] }).success,
    ).toBe(true)
  })
})
