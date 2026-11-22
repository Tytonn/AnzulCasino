/**
 * When a card folds (spec: The stream > Folding): a finished card shows its
 * result for a few seconds, then folds to one line that expands to its
 * replay. A big win (big_win_times or more) or an all-in stays open. A card
 * this tab saw open folds only after it has played its result out; an old
 * result, loaded with the page, is folded from the start.
 */
import { useEffect, useMemo, useState } from 'react'

import type { CardMeta, ChatMessage } from '../../../shared/chat.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { useCardRounds } from '../../kit/cards.ts'
import { isBigWin } from '../../kit/celebrate.tsx'
import { serverNow } from '../../kit/clock.ts'
import { useConfig } from '../../kit/queries.ts'

/** How long a finished card shows its result before it folds. */
export const FOLD_AFTER_MS = 4_000
/** A card that never says it has shown its result folds this long after the round ended. */
const SHOW_LIMIT_MS = 20_000

export type CardState = 'live' | 'big' | 'folded'

/** A round that stays open in the stream: a big win, or any all-in. */
export function isBig(round: RoundView, bigWinTimes: number): boolean {
  return round.allIn || isBigWin(round, bigWinTimes)
}

export function cardRoundId(message: ChatMessage): number {
  const id = Number((message.meta as Partial<CardMeta> | null)?.roundId)
  return Number.isSafeInteger(id) && id > 0 ? id : 0
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
  const bigWinTimes = useConfig().data?.big_win_times ?? 10
  // Read when a card's state is next due to change, so rendering stays pure.
  const [clock, setClock] = useState(readClock)

  const { states, next } = useMemo(() => {
    const { now, server } = clock
    const states = new Map<number, CardState>()
    let next: number | null = null
    for (const message of messages) {
      if (message.kind !== 'card') continue
      const id = cardRoundId(message)
      const round = rounds[id] ?? message.round ?? null
      const { state, changesAt } = cardState({
        round,
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
  }, [messages, rounds, shown, seenOpen, bigWinTimes, clock])

  useEffect(() => {
    if (next === null) return
    const timer = setTimeout(() => setClock(readClock()), Math.max(0, next - Date.now()) + 30)
    return () => clearTimeout(timer)
  }, [next])

  return states
}
