/**
 * The Audit page's sentences (spec: Admin and trust > The audit page): each
 * kind of admin action read as one line anyone understands, with the
 * numbers that changed underneath.
 */
import { describe, expect, it } from 'vitest'

import type { AuditEntryView, AuditPerson } from '../../../shared/features/admin.ts'
import {
  type Described,
  describeEntry,
  describePending,
  joinPeople,
  plainText,
  startsLater,
} from '../../../src/features/admin/audit-text.ts'

function person(id: string, name: string): AuditPerson {
  return {
    id,
    username: name.toLowerCase(),
    displayName: name,
    avatar: 'spade',
    avatarColor: 'violet',
  }
}

const ada = person('a', 'Ada')
const bob = person('b', 'Bob')
const cy = person('c', 'Cy')
const people = { a: ada, b: bob, c: cy }

function entry(fields: Partial<AuditEntryView>): AuditEntryView {
  return {
    id: 1,
    at: '2026-11-22T15:00:00Z',
    action: 'chips.adjusted',
    kind: 'chips',
    actor: ada,
    target: null,
    before: null,
    after: null,
    reason: null,
    season: { id: 3, name: 'Season 3' },
    people,
    ...fields,
  }
}

/** The sentence, and the details on their own lines. */
function read(said: Described): string {
  return [plainText(said.parts), ...said.details].join(' | ')
}

describe('chips', () => {
  it('says whose chips moved and the balance either side', () => {
    const added = entry({
      target: 'bob',
      before: { value: 10_000 },
      after: { userId: 'b', account: 'wallet', delta: 1_050, value: 11_050 },
    })
    expect(read(describeEntry(added))).toBe(
      'Ada added 10.50 chips to Bob’s wallet | Wallet: 100 → 110.50',
    )
    const own = entry({
      before: { value: 500 },
      after: { userId: 'a', account: 'vault', delta: -100, value: 400 },
    })
    expect(read(describeEntry(own))).toBe('Ada took 1 chip from their own vault | Vault: 5 → 4')
  })

  it('reads amounts the foundation stored as text', () => {
    const big = entry({
      before: { value: '900000000000' },
      after: { userId: 'b', account: 'wallet', delta: '100000000000', value: '1000000000000' },
    })
    expect(read(describeEntry(big))).toBe(
      'Ada added 1,000,000,000 chips to Bob’s wallet | Wallet: 9,000,000,000 → 10,000,000,000',
    )
  })

  it('words a giveaway by how it was given', () => {
    const recipients = (ids: string[]) => ids.map((userId) => ({ userId }))
    const one = entry({
      action: 'giveaway.given',
      after: { recipients: recipients(['b']), share: 100, total: 100, amount: 100 },
    })
    expect(read(describeEntry(one))).toBe('Ada gave Bob 1 chip')
    const each = entry({
      action: 'giveaway.given',
      after: { recipients: recipients(['b', 'c']), share: 500, total: 1_000, amount: 500 },
    })
    expect(read(describeEntry(each))).toBe(
      'Ada gave Bob and Cy 5 chips each | 2 players, 10 chips in all',
    )
    const split = entry({
      action: 'giveaway.given',
      after: {
        recipients: recipients(['a', 'b', 'c']),
        everyone: true,
        split: true,
        share: 333,
        total: 999,
        amount: 1_000,
      },
    })
    expect(read(describeEntry(split))).toBe(
      'Ada split 10 chips between all 3 players, 3.33 each | 3 players, 9.99 chips in all',
    )
  })
})

describe('settings', () => {
  it('gives the old and new value in the editor’s words', () => {
    const change = entry({
      action: 'config.changed',
      kind: 'config',
      target: 'work_pay_max',
      before: { value: 600 },
      after: { value: 900, effectiveAt: '2026-11-22T15:00:00Z' },
    })
    expect(read(describeEntry(change))).toBe('Ada changed Work pay max from 6 chips to 9 chips')
  })

  it('says when a change waits for the daily reset', () => {
    const later = entry({
      action: 'config.changed',
      kind: 'config',
      target: 'steal_attempts_per_day',
      before: { value: 2 },
      after: { value: 5, effectiveAt: '2026-11-23T10:00:00Z' },
    })
    expect(read(describeEntry(later))).toBe(
      'Ada changed Steal attempts per day from 2 to 5 | At the daily reset, Mon, Nov 23, 4:00 AM CT',
    )
  })

  it('tells a change that waits for the reset from one that started at once', () => {
    // Saved and started in the same moment; it can reach a page between two
    // ticks of its clock, and must not read as one still to come.
    const atOnce = entry({
      action: 'config.changed',
      kind: 'config',
      target: 'stream_round_runs',
      at: '2026-11-22T01:24:31.053Z',
      before: { value: 'fold' },
      after: { value: 'separate', effectiveAt: '2026-11-22T01:24:31.048Z' },
    })
    expect(startsLater(atOnce)).toBeNull()
    expect(read(describeEntry(atOnce))).toBe(
      'Ada changed Finished rounds from Fold into one line to One line per round',
    )
    const later = entry({
      action: 'config.changed',
      kind: 'config',
      target: 'work_pay_max',
      at: '2026-11-22T01:24:31.053Z',
      before: { value: 600 },
      after: { value: 900, effectiveAt: '2026-11-22T10:00:00Z' },
    })
    expect(startsLater(later)).toEqual(new Date('2026-11-22T10:00:00Z'))
    expect(startsLater(entry({ after: { effectiveAt: '2026-11-22T10:00:00Z' } }))).toBeNull()
  })

  it('names the third button by its name now', () => {
    const change = entry({
      action: 'config.changed',
      kind: 'config',
      target: 'hustle_cooldown_minutes',
      before: { value: 60 },
      after: { value: 45, effectiveAt: '2026-11-22T15:00:00Z' },
    })
    expect(plainText(describeEntry(change, 'Grind').parts)).toBe(
      'Ada changed Grind cooldown from 60 minutes to 45 minutes',
    )
  })

  it('reads words, lines and a change taken back', () => {
    const words = entry({
      action: 'config.changed',
      kind: 'config',
      target: 'command_race',
      before: { value: ['race'] },
      after: { value: ['race', 'rc'], effectiveAt: '2026-11-22T15:00:00Z' },
    })
    expect(read(describeEntry(words))).toMatch(/^Ada changed the words for Race \| .+ → .+$/)
    const lines = entry({
      action: 'config.changed',
      kind: 'config',
      target: 'work_lines',
      before: { value: ['One', 'Two'] },
      after: { value: ['Two', 'Three'], effectiveAt: '2026-11-22T15:00:00Z' },
    })
    expect(read(describeEntry(lines))).toBe(
      'Ada changed Work lines | Added “Three” | Removed “One”',
    )
    const back = entry({
      action: 'config.changed',
      kind: 'config',
      target: 'steal_attempts_per_day',
      before: { value: 2 },
      after: { value: 2, effectiveAt: '2026-11-23T10:00:00Z' },
    })
    expect(plainText(describeEntry(back).parts)).toBe(
      'Ada took back the change waiting for Steal attempts per day',
    )
  })

  it('lists a waiting change with its old and new value', () => {
    const shown = describePending({
      key: 'crime_success_pct',
      value: 5_000,
      current: 4_500,
      effectiveAt: '2026-11-23T10:00:00Z',
      by: ada,
      reason: null,
    })
    expect(shown).toEqual({ label: 'Crime success', change: '45% → 50%' })
  })
})

describe('seasons and accounts', () => {
  it('reads an early end, and a moved end', () => {
    const now = entry({
      action: 'season.ended_early',
      kind: 'seasons',
      before: { endsAt: '2026-12-21T10:00:00Z' },
      after: { immediate: true },
    })
    expect(read(describeEntry(now))).toBe(
      'Ada ended Season 3 early | It was to end Mon, Dec 21, 4:00 AM CT',
    )
    const moved = entry({
      action: 'season.ended_early',
      kind: 'seasons',
      before: { endsAt: '2026-12-21T10:00:00Z' },
      after: { immediate: false, endsAt: '2026-12-01T16:00:00Z' },
    })
    expect(read(describeEntry(moved))).toBe(
      'Ada moved the end of Season 3 to Tue, Dec 1, 10:00 AM CT | It was Mon, Dec 21, 4:00 AM CT',
    )
  })

  it('reads a rename apart from other season changes', () => {
    const renamed = entry({
      action: 'season.updated',
      kind: 'seasons',
      before: { name: 'Season 3' },
      after: { name: 'Winter' },
    })
    expect(read(describeEntry(renamed))).toBe('Ada renamed Season 3 to Winter')
    const changed = entry({
      action: 'season.updated',
      kind: 'seasons',
      before: { startingBalance: 10_000 },
      after: { startingBalance: 20_000 },
    })
    expect(read(describeEntry(changed))).toBe('Ada changed Season 3 | Starting chips: 100 → 200')
  })

  it('reads account changes and reset codes', () => {
    const off = entry({ action: 'player.disabled', kind: 'accounts', after: { userId: 'b' } })
    expect(plainText(describeEntry(off).parts)).toBe('Ada disabled Bob’s account')
    const on = entry({ action: 'player.enabled', kind: 'accounts', target: 'bob' })
    expect(plainText(describeEntry(on).parts)).toBe('Ada let Bob sign in again')
    const reset = entry({ action: 'reset_code.created', kind: 'accounts', target: 'cy' })
    expect(plainText(describeEntry(reset).parts)).toBe('Ada made a password reset code for Cy')
  })

  it('still says something for an action it does not know', () => {
    const odd = entry({ action: 'something.new', kind: null, target: 'x', actor: null })
    expect(plainText(describeEntry(odd).parts)).toBe('Someone did something.new (x)')
  })
})

describe('lists of people', () => {
  it('joins people as a sentence does', () => {
    const names = (parts: ReturnType<typeof joinPeople>) => plainText(parts)
    expect(names(joinPeople([ada]))).toBe('Ada')
    expect(names(joinPeople([ada, bob, cy]))).toBe('Ada, Bob and Cy')
    expect(names(joinPeople([ada, bob, cy, ada, bob], 3))).toBe('Ada, Bob and 3 others')
  })
})
