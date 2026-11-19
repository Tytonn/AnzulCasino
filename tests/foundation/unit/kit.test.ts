/**
 * The game kit's logic: rounds in the room cache, the reveal hold, the
 * ticker cache, the bet box's rules, seats, the chip stack and shortcut keys.
 */
import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SeasonState } from '../../../shared/seasons.ts'
import { type TickerItem, tickerKey } from '../../../shared/ticker.ts'
import { type RoomState, type RoundView, roundVersion } from '../../../shared/rounds.ts'
import { closedReason, stillTyping } from '../../../src/kit/BetBox.tsx'
import { isBigWin } from '../../../src/kit/celebrate.tsx'
import { chipsFor } from '../../../src/kit/ChipStack.tsx'
import { isShortcut, pressesFocused, shortcutKey } from '../../../src/kit/Kbd.tsx'
import { addTickerItem, queryKeys, TICKER_KEEP } from '../../../src/kit/queries.ts'
import { afterReveal, holdReveal } from '../../../src/kit/reveal.ts'
import { upsertRound } from '../../../src/kit/room.ts'
import { seatOutcome, seatTag } from '../../../src/kit/Seat.tsx'

function round(over: Partial<RoundView<{ face?: string }>> = {}): RoundView<{ face?: string }> {
  return {
    id: 7,
    game: 'coinflip',
    userId: 'alice',
    status: 'open',
    stake: 10_000,
    payout: null,
    multiplier: null,
    detail: {},
    summary: null,
    bigBet: false,
    allIn: false,
    steps: 0,
    startedAt: '2026-11-18T10:00:00.000Z',
    settledAt: null,
    ...over,
  }
}

describe('upsertRound', () => {
  const state: RoomState<{ face?: string }> = { rounds: [round()] }

  it('takes a newer step of the same round', () => {
    const settled = round({ status: 'settled', payout: 19_600, steps: 1, detail: { face: 'h' } })
    expect(upsertRound(state, settled)?.rounds).toEqual([settled])
  })

  it('ignores an older or equal version, so a late event cannot undo a result', () => {
    const settled = round({ status: 'settled', payout: 0, steps: 1 })
    const after = upsertRound(state, settled)
    expect(upsertRound(after, round())).toBe(after)
    expect(upsertRound(after, settled)).toBe(after)
  })

  it('a new round replaces the last one, whatever its steps', () => {
    const old = round({ status: 'settled', steps: 9 })
    const next = round({ id: 8 })
    expect(roundVersion(next)).toBeGreaterThan(roundVersion(old))
    expect(upsertRound({ rounds: [old] }, next)?.rounds).toEqual([next])
  })

  it('adds a player who had no round, and leaves an unloaded room alone', () => {
    const bob = round({ id: 9, userId: 'bob' })
    expect(upsertRound(state, bob)?.rounds).toHaveLength(2)
    expect(upsertRound(undefined, bob)).toBeUndefined()
  })
})

describe('the reveal hold', () => {
  // The hold is one store for the page. Each test starts an hour after the
  // last, so an earlier test's animation has long ended.
  let hour = 0
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2030, 0, 1) + ++hour * 3_600_000)
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('runs news at once when nothing is being revealed', () => {
    const task = vi.fn()
    afterReveal('alice', task)
    expect(task).toHaveBeenCalledOnce()
  })

  it('holds news while the request is out and until the animation ends', () => {
    const task = vi.fn()
    const release = holdReveal({ players: ['alice'] })
    afterReveal('alice', task)
    vi.advanceTimersByTime(5_000)
    expect(task).not.toHaveBeenCalled()

    release(900)
    vi.advanceTimersByTime(899)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledOnce()
  })

  it('waits for every request in flight, and releasing twice changes nothing', () => {
    const task = vi.fn()
    const first = holdReveal({ players: ['alice'] })
    const second = holdReveal({ players: ['alice'] })
    afterReveal('alice', task)
    first(0)
    first(0)
    vi.advanceTimersByTime(10)
    expect(task).not.toHaveBeenCalled()
    second(0)
    expect(task).toHaveBeenCalledOnce()
  })

  it('lets the news go after 15 seconds if a request never answers', () => {
    const task = vi.fn()
    holdReveal({ players: ['alice'] })
    afterReveal('alice', task)
    vi.advanceTimersByTime(14_999)
    expect(task).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(task).toHaveBeenCalledOnce()
  })

  it('holds only the players it names, so other news goes on', () => {
    const bob = vi.fn()
    const carol = vi.fn()
    const dave = vi.fn()
    // A roulette close: every bettor waits for the wheel.
    const release = holdReveal({ players: ['bob', 'carol'] })
    afterReveal('bob', bob)
    afterReveal('carol', carol)
    afterReveal('dave', dave)
    expect(dave).toHaveBeenCalledOnce()
    expect(bob).not.toHaveBeenCalled()
    expect(carol).not.toHaveBeenCalled()

    release(6_000)
    vi.advanceTimersByTime(5_999)
    expect(bob).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(bob).toHaveBeenCalledOnce()
    expect(carol).toHaveBeenCalledOnce()
  })

  it("waits for each hold on a player, yours and the table's", () => {
    const task = vi.fn()
    const mine = holdReveal({ players: ['alice'] })
    const table = holdReveal({ players: ['alice', 'bob'] })
    afterReveal('alice', task)
    mine(300)
    vi.advanceTimersByTime(300)
    expect(task).not.toHaveBeenCalled()
    table(0)
    expect(task).toHaveBeenCalledOnce()
  })

  it("plays one player's news in the order it came, even past a late timer", () => {
    const order: string[] = []
    const release = holdReveal({ players: ['alice'] })
    afterReveal('alice', () => order.push('first'))
    release(500)
    // The animation is over, but its timer has not fired yet.
    vi.setSystemTime(Date.now() + 600)
    afterReveal('alice', () => order.push('second'))
    expect(order).toEqual(['first', 'second'])
  })

  it('holds nobody when nobody bet', () => {
    const task = vi.fn()
    holdReveal({ players: [] })
    afterReveal('alice', task)
    expect(task).toHaveBeenCalledOnce()
  })
})

describe('the ticker cache', () => {
  const settled = (roundId: number): TickerItem => ({
    kind: 'round',
    round: {
      seasonId: 1,
      roundId,
      game: 'coinflip',
      userId: 'alice',
      stake: 10_000,
      payout: 0,
      net: -10_000,
      multiplier: null,
      summary: 'Heads',
      bigBet: false,
    },
  })
  const steal = (id: number): TickerItem => ({
    kind: 'steal',
    steal: {
      id,
      seasonId: 1,
      thiefId: 'bob',
      targetId: 'alice',
      gameDay: '2026-11-19',
      outcome: 'success',
      amount: 12_500,
      fine: 0,
      thiefRank: 4,
      targetRank: 1,
      createdAt: '2026-11-19T20:00:00.000Z',
    },
  })
  const keys = (queryClient: QueryClient) =>
    queryClient.getQueryData<TickerItem[]>(queryKeys.ticker)?.map(tickerKey)

  it('adds each round and steal once, newest first, even when their ids match', () => {
    const queryClient = new QueryClient()
    // Nothing fetched yet: the fetch brings it.
    addTickerItem(queryClient, settled(1))
    expect(keys(queryClient)).toBeUndefined()

    queryClient.setQueryData<TickerItem[]>(queryKeys.ticker, [settled(1)])
    addTickerItem(queryClient, steal(1))
    addTickerItem(queryClient, settled(1))
    addTickerItem(queryClient, steal(1))
    expect(keys(queryClient)).toEqual(['steal:1', 'round:1'])
  })

  it(`keeps the newest ${TICKER_KEEP}`, () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<TickerItem[]>(queryKeys.ticker, [])
    for (let id = 1; id <= TICKER_KEEP + 5; id++) {
      addTickerItem(queryClient, id % 2 ? settled(id) : steal(id))
    }
    const kept = keys(queryClient) ?? []
    expect(kept).toHaveLength(TICKER_KEEP)
    expect(kept[0]).toBe(`round:${TICKER_KEEP + 5}`)
    expect(kept.at(-1)).toBe('steal:6')
  })
})

describe('seats', () => {
  it('reads where a round stands', () => {
    expect(seatOutcome(null)).toEqual({ kind: 'none' })
    expect(seatOutcome(round())).toEqual({ kind: 'open', stake: 10_000 })
    expect(
      seatOutcome(round({ status: 'settled', payout: 19_600, multiplier: 196, steps: 1 })),
    ).toEqual({ kind: 'win', stake: 10_000, net: 9_600, multiplier: 196 })
    expect(seatOutcome(round({ status: 'settled', payout: 2_500, steps: 1 }))).toEqual({
      kind: 'loss',
      stake: 10_000,
      lost: 7_500,
    })
    expect(seatOutcome(round({ status: 'settled', payout: 10_000, steps: 1 }))).toEqual({
      kind: 'push',
      stake: 10_000,
    })
    expect(seatOutcome(round({ status: 'void', payout: 10_000, steps: 1 }))).toEqual({
      kind: 'void',
      stake: 10_000,
    })
  })

  it('tags a big bet or an all-in only while the round is open', () => {
    expect(seatTag(round())).toBeNull()
    expect(seatTag(round({ bigBet: true }))).toBe('Big bet')
    expect(seatTag(round({ bigBet: true, allIn: true }))).toBe('All in')
    expect(seatTag(round({ allIn: true, status: 'settled', steps: 1 }))).toBeNull()
  })

  it('celebrates by the same rule the server posts in chat', () => {
    expect(isBigWin({ stake: 100, payout: 1_000, allIn: false }, 10)).toBe(true)
    expect(isBigWin({ stake: 100, payout: 999, allIn: false }, 10)).toBe(false)
    expect(isBigWin({ stake: 100, payout: 196, allIn: true }, 10)).toBe(true)
    expect(isBigWin({ stake: 100, payout: 0, allIn: true }, 10)).toBe(false)
    expect(isBigWin({ stake: 100, payout: null, allIn: true }, 10)).toBe(false)
  })

  it('grows the chip stack with each tenfold', () => {
    expect(chipsFor(0)).toBe(0)
    expect(chipsFor(50)).toBe(1) // half a chip
    expect(chipsFor(900)).toBe(1) // 9 chips
    expect(chipsFor(1_000)).toBe(2) // 10 chips
    expect(chipsFor(100_000)).toBe(4) // 1,000 chips
    expect(chipsFor(10 ** 15)).toBe(6)
  })
})

describe('the bet box', () => {
  const season = (over: Partial<SeasonState> = {}): SeasonState => ({
    current: {
      id: 1,
      name: 'November',
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
      startingBalance: 100_000,
      status: 'active',
      phase: 'open',
    },
    next: null,
    wallet: { balance: 100_000, vault: 0, tier: 'base', version: 3 },
    ...over,
  })

  it('says in plain words why the table takes no bets', () => {
    expect(closedReason(undefined)).toBeNull()
    expect(closedReason(season())).toBeNull()
    expect(closedReason(season({ current: null }))).toBe('No season is running yet.')
    const base = season().current
    if (!base) throw new Error('expected a season')
    expect(closedReason(season({ current: { ...base, phase: 'upcoming' } }))).toMatch(/starts/)
    expect(closedReason(season({ current: { ...base, phase: 'over' } }))).toMatch(/closed/)
    expect(closedReason(season({ current: { ...base, phase: 'final_day' } }))).toBeNull()
    expect(closedReason(season({ wallet: null }))).toMatch(/no chips/)
  })

  it('waits for a half-typed word before calling it wrong', () => {
    for (const text of ['a', 'al', 'all-', 'h', 'hal', 'm', 'ma', '.']) {
      expect(stillTyping(text)).toBe(true)
    }
    for (const text of ['all', 'half', 'max', 'x', '12', 'alll', '']) {
      expect(stillTyping(text)).toBe(text === '')
    }
  })
})

describe('shortcut keys', () => {
  function target(tagName: string, extra: Record<string, unknown> = {}): HTMLElement {
    return {
      tagName,
      isContentEditable: false,
      closest: (selector: string) =>
        (extra.inside as string[] | undefined)?.some((s) => selector.includes(s)) ? {} : null,
      ...extra,
    } as unknown as HTMLElement
  }
  function key(k: string, on: HTMLElement, mods: Partial<KeyboardEvent> = {}): KeyboardEvent {
    return {
      key: k,
      target: on,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
      ...mods,
    } as KeyboardEvent
  }

  it('leaves typing alone, but not buttons or checkboxes', () => {
    expect(isShortcut(key('h', target('BODY')))).toBe(true)
    expect(isShortcut(key('h', target('INPUT', { type: 'text' })))).toBe(false)
    expect(isShortcut(key('h', target('INPUT', { type: 'checkbox' })))).toBe(true)
    expect(isShortcut(key('h', target('TEXTAREA')))).toBe(false)
    expect(isShortcut(key('h', target('DIV', { isContentEditable: true })))).toBe(false)
    expect(isShortcut(key('h', target('BUTTON')))).toBe(true)
  })

  it('stays out of dialogs and of keys held with a modifier or held down', () => {
    expect(isShortcut(key('h', target('BUTTON', { inside: ['dialog'] })))).toBe(false)
    expect(isShortcut(key('h', target('BODY'), { ctrlKey: true }))).toBe(false)
    expect(isShortcut(key('h', target('BODY'), { repeat: true }))).toBe(false)
  })

  it('lets a focused button take its own Enter and Space', () => {
    expect(pressesFocused(key('Enter', target('BUTTON', { inside: ['button'] })))).toBe(true)
    expect(pressesFocused(key(' ', target('BUTTON', { inside: ['button'] })))).toBe(true)
    expect(pressesFocused(key('h', target('BUTTON', { inside: ['button'] })))).toBe(false)
    expect(pressesFocused(key('Enter', target('BODY')))).toBe(false)
  })

  it('names keys the way a shortcut map does', () => {
    expect(shortcutKey(key('H', target('BODY')))).toBe('h')
    expect(shortcutKey(key(' ', target('BODY')))).toBe('Space')
    expect(shortcutKey(key('Enter', target('BODY')))).toBe('Enter')
    expect(shortcutKey(key('?', target('BODY')))).toBe('?')
  })
})
