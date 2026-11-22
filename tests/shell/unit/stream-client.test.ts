/**
 * The stream in the browser (spec: The stream): each filter's list in the
 * cache, the rows it draws, and when a finished card folds.
 */
import { describe, expect, it } from 'vitest'

import type { ChatMessage, StreamPage } from '../../../shared/chat.ts'
import type { RoundView, SharedRoundView } from '../../../shared/rounds.ts'
import {
  addItem,
  addOlder,
  mergeNewest,
  removeItem,
  STREAM_KEEP,
  type StreamList,
} from '../../../src/shell/stream/cache.ts'
import {
  type CardState,
  cardState,
  FOLD_AFTER_MS,
  SHARED_FOLD_AFTER_MS,
  sharedCardState,
} from '../../../src/shell/stream/fold.ts'
import type { PrivateItem } from '../../../src/shell/stream/private.ts'
import { buildRows, GROUP_MS } from '../../../src/shell/stream/rows.ts'

const AT = Date.parse('2026-11-22T12:00:00Z')

function chat(id: number, userId = 'alice', minutes = id): ChatMessage {
  return {
    id,
    userId,
    kind: 'player',
    body: `message ${id}`,
    meta: null,
    createdAt: new Date(AT + minutes * 60_000).toISOString(),
  }
}

function card(id: number, userId = 'alice', roundId = id): ChatMessage {
  return {
    ...chat(id, userId),
    kind: 'card',
    body: 'Blackjack',
    meta: { game: 'blackjack', roundId },
  }
}

/** A shared round's card (a roulette round): everyone's, with no player of its own. */
function sharedCard(id: number, sharedRoundId = id): ChatMessage {
  return {
    ...chat(id),
    userId: null,
    kind: 'card',
    body: `Roulette · Round ${sharedRoundId}`,
    meta: { game: 'roulette', sharedRoundId },
  }
}

function news(id: number, category: 'game' | 'news' = 'news'): ChatMessage {
  return { ...chat(id, ''), userId: null, kind: 'system', meta: { tone: 'info', category } }
}

const page = (items: ChatMessage[], more = false): StreamPage => ({
  filter: 'all',
  items,
  more,
  mine: [],
})

describe('the cache', () => {
  it('joins a fetched newest page to what is loaded, or starts over after a gap', () => {
    const loaded: StreamList = { items: [chat(1), chat(2), chat(3)], more: true }
    expect(mergeNewest(loaded, page([chat(3), chat(4)], true)).items.map((m) => m.id)).toEqual([
      1, 2, 3, 4,
    ])
    expect(mergeNewest(loaded, page([chat(9), chat(10)], true)).items.map((m) => m.id)).toEqual([
      9, 10,
    ])
  })

  it('adds a live item once, in order, only where its filter shows it', () => {
    const list: StreamList = { items: [chat(1), chat(3)], more: false }
    expect(addItem(list, chat(2), 'all')?.items.map((m) => m.id)).toEqual([1, 2, 3])
    expect(addItem(list, chat(3), 'all')).toBe(list)
    expect(addItem(list, card(4), 'chat')).toBe(list)
    expect(addItem(list, card(4), 'games')?.items.map((m) => m.id)).toEqual([1, 3, 4])
    expect(addItem(list, news(5), 'chat')?.items.map((m) => m.id)).toEqual([1, 3, 5])
    expect(addItem(undefined, chat(2), 'all')).toBeUndefined()
  })

  it('keeps the newest items when it grows too long', () => {
    const items = Array.from({ length: STREAM_KEEP }, (_, i) => chat(i + 1))
    const grown = addItem({ items, more: false }, chat(STREAM_KEEP + 1), 'all')
    expect(grown?.items).toHaveLength(STREAM_KEEP)
    expect(grown?.items[0]?.id).toBe(2)
    expect(grown?.more).toBe(true)
  })

  it('removes a deleted item and adds older pages above', () => {
    const list: StreamList = { items: [chat(5), chat(6)], more: true }
    expect(removeItem(list, 5)?.items.map((m) => m.id)).toEqual([6])
    expect(removeItem(list, 7)).toBe(list)
    const older = addOlder(list, page([chat(3), chat(4), chat(5)], false))
    expect(older?.items.map((m) => m.id)).toEqual([3, 4, 5, 6])
    expect(older?.more).toBe(false)
  })
})

describe('the rows', () => {
  const rows = (
    items: ChatMessage[],
    options: {
      states?: [number, CardState][]
      privates?: PrivateItem[]
      pinned?: number[]
      foldRuns?: boolean
    } = {},
  ) =>
    buildRows({
      items,
      privates: options.privates ?? [],
      states: new Map(options.states ?? []),
      pinned: new Set(options.pinned ?? []),
      foldRuns: options.foldRuns ?? true,
    })

  it('groups one player’s messages close together under one header', () => {
    const drawn = rows([chat(1, 'alice', 0), chat(2, 'alice', 1), chat(3, 'bob', 2)])
    expect(drawn.map((r) => (r.kind === 'message' ? r.grouped : null))).toEqual([
      false,
      true,
      false,
    ])
    const later = rows([chat(1, 'alice', 0), chat(2, 'alice', GROUP_MS / 60_000 + 1)])
    expect(later.map((r) => (r.kind === 'message' ? r.grouped : null))).toEqual([false, false])
  })

  it('folds a run of one player’s finished cards into one line, if the setting says so', () => {
    const items = [card(1), card(2), card(3), card(4, 'bob'), chat(5)]
    const states: [number, CardState][] = [
      [1, 'folded'],
      [2, 'folded'],
      [3, 'folded'],
      [4, 'folded'],
    ]
    const folded = rows(items, { states })
    expect(folded.map((r) => r.kind)).toEqual(['run', 'card', 'message'])
    const run = folded[0]
    expect(run?.kind === 'run' && run.messages.map((m) => m.id)).toEqual([1, 2, 3])

    const separate = rows(items, { states, foldRuns: false })
    expect(separate.map((r) => r.kind)).toEqual(['card', 'card', 'card', 'card', 'message'])
  })

  it('keeps a live or big card on its own, and a pinned one as a slim line', () => {
    const items = [card(1), card(2), card(3)]
    const drawn = rows(items, {
      states: [
        [1, 'folded'],
        [2, 'big'],
        [3, 'live'],
      ],
      pinned: [3],
    })
    expect(drawn.map((r) => r.kind)).toEqual(['card', 'card', 'stub'])
  })

  it('keeps a shared round’s card on its own line, out of any run', () => {
    const folded = (ids: number[]): [number, CardState][] => ids.map((id) => [id, 'folded'])
    const drawn = rows([card(1), sharedCard(2), card(3), card(4)], { states: folded([1, 2, 3, 4]) })
    expect(drawn.map((r) => r.kind)).toEqual(['card', 'card', 'run'])
    const run = drawn[2]
    expect(run?.kind === 'run' && run.messages.map((m) => m.id)).toEqual([3, 4])
    // Two rounds in a row are two lines, and a pinned one is a slim line.
    expect(
      rows([sharedCard(1), sharedCard(2)], { states: folded([1, 2]) }).map((r) => r.kind),
    ).toEqual(['card', 'card'])
    expect(rows([sharedCard(1)], { pinned: [1] }).map((r) => r.kind)).toEqual(['stub'])
  })

  it('puts private replies right after the item that was newest when they came', () => {
    const reply = { label: 'Commands', content: 'help' }
    const drawn = rows([chat(1), chat(2), chat(3)], {
      privates: [
        { id: 1, afterId: 1, reply },
        { id: 2, afterId: 3, reply },
      ],
    })
    expect(drawn.map((r) => (r.kind === 'private' ? `p${r.item.id}` : r.kind))).toEqual([
      'message',
      'p1',
      'message',
      'message',
      'p2',
    ])
  })
})

describe('folding a card', () => {
  const round = (over: Partial<RoundView>): RoundView => ({
    id: 1,
    game: 'blackjack',
    userId: 'alice',
    status: 'settled',
    stake: 5_000,
    payout: 0,
    multiplier: 0,
    detail: {},
    summary: 'Bust',
    bigBet: false,
    allIn: false,
    steps: 3,
    startedAt: new Date(AT - 10_000).toISOString(),
    settledAt: new Date(AT).toISOString(),
    ...over,
  })
  const state = (input: Partial<Parameters<typeof cardState>[0]>) =>
    cardState({
      round: round({}),
      shownAt: null,
      seenOpen: false,
      bigWinTimes: 10,
      now: AT,
      serverNow: AT,
      ...input,
    })

  it('keeps an open round live', () => {
    expect(state({ round: round({ status: 'open', settledAt: null }) })).toEqual({
      state: 'live',
      changesAt: null,
    })
  })

  it('folds a few seconds after the card shows its result', () => {
    expect(state({ shownAt: AT })).toEqual({ state: 'live', changesAt: AT + FOLD_AFTER_MS })
    expect(state({ shownAt: AT, now: AT + FOLD_AFTER_MS }).state).toBe('folded')
  })

  it('folds an old result from the start', () => {
    expect(state({ serverNow: AT + 60_000, now: AT + 60_000 }).state).toBe('folded')
  })

  it('waits longer for a card this tab saw open', () => {
    const seen = state({ seenOpen: true, serverNow: AT + FOLD_AFTER_MS, now: AT + FOLD_AFTER_MS })
    expect(seen.state).toBe('live')
  })

  it('keeps a big win and any all-in open', () => {
    expect(state({ round: round({ payout: 60_000 }), shownAt: AT - 60_000 }).state).toBe('big')
    expect(state({ round: round({ allIn: true }), shownAt: AT - 60_000 }).state).toBe('big')
  })
})

describe('folding a shared round’s card', () => {
  const view = (settled: boolean): SharedRoundView => ({
    id: 9,
    game: 'roulette',
    roundNo: 3,
    state: settled ? 'settled' : 'betting',
    opensAt: new Date(AT - 20_000).toISOString(),
    closesAt: new Date(AT).toISOString(),
    settledAt: settled ? new Date(AT).toISOString() : null,
    result: null,
    rounds: [],
    version: 0,
  })
  const state = (input: Partial<Parameters<typeof sharedCardState>[0]>) =>
    sharedCardState({
      view: view(true),
      shownAt: null,
      seenOpen: false,
      now: AT,
      serverNow: AT,
      ...input,
    })

  it('keeps an open round live, however long it runs', () => {
    expect(state({ view: view(false), serverNow: AT + 600_000 })).toEqual({
      state: 'live',
      changesAt: null,
    })
  })

  it('folds a while after the card shows the result', () => {
    expect(state({ shownAt: AT })).toEqual({ state: 'live', changesAt: AT + SHARED_FOLD_AFTER_MS })
    expect(state({ shownAt: AT, now: AT + SHARED_FOLD_AFTER_MS }).state).toBe('folded')
  })

  it('waits a while for a round this tab saw open to show, and folds an old one sooner', () => {
    expect(state({ seenOpen: true, serverNow: AT + 18_000 }).state).toBe('live')
    expect(state({ seenOpen: true, serverNow: AT + 21_000 }).state).toBe('folded')
    expect(state({ serverNow: AT + 5_000 })).toEqual({ state: 'live', changesAt: AT + 10_000 })
    expect(state({ serverNow: AT + 16_000 }).state).toBe('folded')
    expect(state({ view: null }).state).toBe('folded')
  })
})
