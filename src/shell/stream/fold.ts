/**
 * When a card folds (spec: The stream > Folding): a finished card shows its
 * result for a few seconds, then folds to one line that expands to its
 * replay. A big win (big_win_times or more) or an all-in stays open. A card
 * this tab saw open folds only after it has played its result out; an old
 * result, loaded with the page, is folded from the start. A shared round's
 * card (a roulette round) shows its result a little longer, since it lists
 * everyone at the table, and always folds.
 */
import { useEffect, useMemo, useState } from 'react'

import type { CardMeta, ChatMessage, SharedCardMeta } from '../../../shared/chat.ts'
import type { RoundView, SharedRoundView } from '../../../shared/rounds.ts'
import { useCardRounds, useSharedRounds } from '../../kit/cards.ts'
import { isBigWin } from '../../kit/celebrate.tsx'
import { serverNow } from '../../kit/clock.ts'
import { useConfig } from '../../kit/queries.ts'

/** How long a finished card shows its result before it folds. */
export const FOLD_AFTER_MS = 4_000
/** A card that never says it has shown its result folds this long after the round ended. */
const SHOW_LIMIT_MS = 20_000
/** How long a shared round's card shows its result: everyone's net, winners first. */
export const SHARED_FOLD_AFTER_MS = 8_000
/**
 * A shared card this tab saw open that never says it has shown its result
 * folds this long after the draw.
 */
const SHARED_SHOW_LIMIT_MS = 20_000
/** One that was already drawn when it first came. */
const SHARED_LATE_LIMIT_MS = 15_000

export type CardState = 'live' | 'big' | 'folded'

/** A round that stays open in the stream: a big win, or any all-in. */
export function isBig(round: RoundView, bigWinTimes: number): boolean {
  return round.allIn || isBigWin(round, bigWinTimes)
}

export function cardRoundId(message: ChatMessage): number {
  const id = Number((message.meta as Partial<CardMeta> | null)?.roundId)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

/** The shared round a shared card shows, or 0 for a player's own card. */
export function cardSharedRoundId(message: ChatMessage): number {
  const id = Number((message.meta as Partial<SharedCardMeta> | null)?.sharedRoundId)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

/** A shared round's one card, such as a roulette spin's, rather than a player's own. */
export function isSharedCard(message: ChatMessage): boolean {
  return message.kind === 'card' && cardSharedRoundId(message) > 0
}

/** A shared card's state now, and when it next changes: as cardState, without big moments. */
export function sharedCardState(input: {
  view: SharedRoundView | null
  shownAt: number | null
  seenOpen: boolean
  now: number
  serverNow: number
}): { state: CardState; changesAt: number | null } {
  const { view, shownAt, now } = input
  if (!view) return { state: 'folded', changesAt: null }
  if (view.settledAt === null) return { state: 'live', changesAt: null }
  if (shownAt !== null) {
    const folds = shownAt + SHARED_FOLD_AFTER_MS
    return now >= folds ? { state: 'folded', changesAt: null } : { state: 'live', changesAt: folds }
  }
  const drawn = Date.parse(view.settledAt)
  const limit = drawn + (input.seenOpen ? SHARED_SHOW_LIMIT_MS : SHARED_LATE_LIMIT_MS)
  if (input.serverNow >= limit) return { state: 'folded', changesAt: null }
  return { state: 'live', changesAt: now + (limit - input.serverNow) }
}

/**
 * A card's state now, and when it next changes (epoch milliseconds), or
 * null when it does not change by itself.
 */
export function cardState(input: {
  round: RoundView | null
  shownAt: number | null
  seenOpen: boolean
  bigWinTimes: number
  /** Your clock and the server's, in epoch milliseconds. */
  now: number
  serverNow: number
}): { state: CardState; changesAt: number | null } {
  const { round, shownAt, now } = input
  if (!round) return { state: 'folded', changesAt: null }
  if (round.status === 'open') return { state: 'live', changesAt: null }
  if (isBig(round, input.bigWinTimes)) return { state: 'big', changesAt: null }
  if (shownAt !== null) {
    const folds = shownAt + FOLD_AFTER_MS
    return now >= folds ? { state: 'folded', changesAt: null } : { state: 'live', changesAt: folds }
  }
  const settled = round.settledAt ? Date.parse(round.settledAt) : 0
  const limit = settled + (input.seenOpen ? SHOW_LIMIT_MS : FOLD_AFTER_MS)
  if (input.serverNow >= limit) return { state: 'folded', changesAt: null }
  return { state: 'live', changesAt: now + (limit - input.serverNow) }
}

/** Your clock and the server's, read together. */
function readClock(): { now: number; server: number } {
  return { now: Date.now(), server: serverNow() }
}

/** Each card's state by message id, kept current as rounds end and results show. */
export function useCardStates(messages: readonly ChatMessage[]): ReadonlyMap<number, CardState> {
  const { rounds, shown, seenOpen } = useCardRounds()
  const shared = useSharedRounds()
  const bigWinTimes = useConfig().data?.big_win_times ?? 10
  // Read when a card's state is next due to change, so rendering stays pure.
  const [clock, setClock] = useState(readClock)

  const { states, next } = useMemo(() => {
    const { now, server } = clock
    const states = new Map<number, CardState>()
    let next: number | null = null
    for (const message of messages) {
      if (message.kind !== 'card') continue
      const sharedId = cardSharedRoundId(message)
      const id = cardRoundId(message)
      const { state, changesAt } =
        sharedId > 0
          ? sharedCardState({
              view: shared.rounds[sharedId] ?? message.sharedRound ?? null,
              shownAt: shared.shown[sharedId] ?? null,
              seenOpen: shared.seenOpen[sharedId] === true,
              now,
              serverNow: server,
            })
          : cardState({
              round: rounds[id] ?? message.round ?? null,
              shownAt: shown[id] ?? null,
              seenOpen: seenOpen[id] === true,
              bigWinTimes,
              now,
              serverNow: server,
            })
      states.set(message.id, state)
      if (changesAt !== null && (next === null || changesAt < next)) next = changesAt
    }
    return { states, next }
  }, [messages, rounds, shown, seenOpen, shared, bigWinTimes, clock])

  useEffect(() => {
    if (next === null) return
    const timer = setTimeout(() => setClock(readClock()), Math.max(0, next - Date.now()) + 30)
    return () => clearTimeout(timer)
  }, [next])

  return states
}
