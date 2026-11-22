/**
 * Your cards above the message box (spec: The stream > Pinned): a card of
 * yours sits there, in thumb reach, while its round is open and for a few
 * seconds after its result shows; its place in the stream shows a slim
 * "pinned below" line. So does a shared card you have a bet on, such as a
 * roulette spin. Two at once both pin, the newer one open.
 */
import { create } from 'zustand'

import type { ChatMessage } from '../../../shared/chat.ts'
import { putRound, putSharedRound } from '../../kit/cards.ts'

/** How long a finished card stays pinned after its result shows, for Space to deal again. */
export const PIN_HOLD_MS = 5_000

interface Pins {
  /** Your pinned cards, oldest first. */
  cards: readonly ChatMessage[]
}

export const usePins = create<Pins>(() => ({ cards: [] }))

/** Cards that pinned and let go: a late echo of one never pins it again. */
const released = new Set<number>()

/** Pins a card of yours, or a shared card you have a bet on, once. */
export function pinCard(card: ChatMessage): void {
  if (card.round) putRound(card.round)
  if (card.sharedRound) putSharedRound(card.sharedRound)
  if (released.has(card.id)) return
  usePins.setState((state) =>
    state.cards.some((c) => c.id === card.id)
      ? state
      : { cards: [...state.cards, card].sort((a, b) => a.id - b.id) },
  )
}

export function unpinCard(id: number): void {
  released.add(id)
  usePins.setState((state) =>
    state.cards.some((c) => c.id === id)
      ? { cards: state.cards.filter((c) => c.id !== id) }
      : state,
  )
}

export function usePinned(id: number): boolean {
  return usePins((s) => s.cards.some((c) => c.id === id))
}
