/**
 * The shell's caches: the leaderboard kept current from live events, the
 * arrows for who moved, and the chat list.
 */
import { describe, expect, it } from 'vitest'

import type { ChatMessage, ChatPage } from '../../../shared/chat.ts'
import type { LeaderboardView, StandingView } from '../../../shared/seasons.ts'
import { addMessage, addOlder, mergeNewest, removeMessage } from '../../../src/shell/chat-cache.ts'
import { applyStanding, rankMoves, rerank, soleLeader } from '../../../src/shell/standings.ts'

function standing(userId: string, rank: number, netWorth: number, version = 1): StandingView {
  return {
    rank,
    userId,
    username: userId,
    displayName: userId,
    avatar: 'chip',
    avatarColor: 'violet',
    tier: 'base',
    balance: netWorth,
    vault: 0,
    netWorth,
    version,
  }
}

const board: LeaderboardView = {
  seasonId: 1,
  standings: [standing('a', 1, 300, 5), standing('b', 2, 200, 6), standing('c', 3, 100, 7)],
}

describe('applyStanding', () => {
  it('moves a player up when their net worth passes others', () => {
    const next = applyStanding(
      board,
      { seasonId: 1, userId: 'c', balance: 350, vault: 0, netWorth: 350, tier: 'bronze' },
      8,
    )
    if (next === 'refetch') throw new Error('expected a board')
    expect(next.standings.map((s) => [s.userId, s.rank])).toEqual([
      ['c', 1],
      ['a', 2],
      ['b', 3],
    ])
    expect(next.standings[0]).toMatchObject({ balance: 350, tier: 'bronze', version: 8 })
  })

  it('drops stale news and news for another season', () => {
    const change = { seasonId: 1, userId: 'c', balance: 999, vault: 0, netWorth: 999, tier: 'base' }
    expect(applyStanding(board, change, 7)).toBe(board)
    expect(applyStanding(board, { ...change, seasonId: 2 }, 99)).toBe(board)
  })

  it('asks for a fetch when it does not know the player', () => {
    const change = { seasonId: 1, userId: 'new', balance: 1, vault: 0, netWorth: 1, tier: 'base' }
    expect(applyStanding(board, change, 99)).toBe('refetch')
    expect(applyStanding({ seasonId: null, standings: [] }, change, 99)).toBe('refetch')
  })

  it('keeps players level on net worth in their old order', () => {
    const level = rerank([standing('x', 1, 100), standing('y', 2, 100), standing('z', 3, 150)])
    expect(level.map((s) => [s.userId, s.rank])).toEqual([
      ['z', 1],
      ['x', 2],
      ['y', 3],
    ])
  })

  it('keeps players the server ranked level together until one of them moves', () => {
    const start = [standing('a', 1, 100), standing('b', 1, 100), standing('c', 1, 100)]
    const next = applyStanding(
      { seasonId: 1, standings: start },
      { seasonId: 1, userId: 'b', balance: 98, vault: 0, netWorth: 98, tier: 'base' },
      2,
    )
    if (next === 'refetch') throw new Error('expected a board')
    expect(next.standings.map((s) => [s.userId, s.rank])).toEqual([
      ['a', 1],
      ['c', 1],
      ['b', 3],
    ])
    // Back to 100 later than the others: behind them, as on the server.
    const back = applyStanding(
      next,
      { seasonId: 1, userId: 'b', balance: 100, vault: 0, netWorth: 100, tier: 'base' },
      3,
    )
    if (back === 'refetch') throw new Error('expected a board')
    expect(back.standings.map((s) => [s.userId, s.rank])).toEqual([
      ['a', 1],
      ['c', 1],
      ['b', 3],
    ])
  })
})

describe('soleLeader', () => {
  it('names the leader only when they lead alone', () => {
    expect(soleLeader(board.standings)).toBe('a')
    expect(soleLeader([standing('a', 1, 100), standing('b', 1, 100)])).toBeNull()
    expect(soleLeader([])).toBeNull()
  })
})

describe('rankMoves', () => {
  it('marks who went up and who went down, and keeps earlier arrows', () => {
    const after = rerank([standing('a', 1, 300), standing('b', 2, 200), standing('c', 3, 500)])
    const moves = rankMoves(
      board.standings,
      after,
      new Map([['z', { direction: 'up', change: 1 }]]),
      2,
    )
    expect(Object.fromEntries(moves)).toEqual({
      z: { direction: 'up', change: 1 },
      c: { direction: 'up', change: 2 },
      a: { direction: 'down', change: 2 },
      b: { direction: 'down', change: 2 },
    })
  })
})

function message(id: number): ChatMessage {
  return { id, userId: 'u', kind: 'player', body: `m${id}`, meta: null, createdAt: '' }
}

function page(ids: number[], more: boolean): ChatPage {
  return { messages: ids.map(message), more }
}

const ids = (p: ChatPage | undefined) => p?.messages.map((m) => m.id)

describe('chat cache', () => {
  it('merges a fresh newest page with older messages that join up', () => {
    const merged = mergeNewest(page([1, 2, 3, 4, 5], false), page([4, 6, 7], true))
    // 5 was deleted while away: the fresh page wins for its range.
    expect(ids(merged)).toEqual([1, 2, 3, 4, 6, 7])
    expect(merged.more).toBe(false)
  })

  it('starts over when too much was missed to join up', () => {
    const merged = mergeNewest(page([1, 2], false), page([50, 51], true))
    expect(ids(merged)).toEqual([50, 51])
    expect(merged.more).toBe(true)
  })

  it('adds each live message once, in order, and removes deleted ones', () => {
    let state: ChatPage | undefined = page([1, 3], false)
    state = addMessage(state, message(4))
    state = addMessage(state, message(2))
    state = addMessage(state, message(4))
    expect(ids(state)).toEqual([1, 2, 3, 4])
    expect(ids(removeMessage(state, 3))).toEqual([1, 2, 4])
    expect(addMessage(undefined, message(1))).toBeUndefined()
  })

  it('puts older pages in front', () => {
    const state = addOlder(page([10, 11], true), page([8, 9, 10], false))
    expect(ids(state)).toEqual([8, 9, 10, 11])
    expect(state?.more).toBe(false)
  })
})
