/**
 * Cards in the stream (spec: The stream > Cards): what a game's card and its
 * commands share with the shell.
 *
 * - Every card's round, kept in one store. Rounds come from the stream page,
 *   the card's live news, the room's events and your own answers; the newest
 *   version wins (roundVersion), whatever order they arrive in.
 * - When a card has shown its round's result, so the shell can fold it a
 *   few seconds later.
 * - Which card has the keys: after a command opens a card, H, S, D, P and
 *   Space go to it until the player types again.
 * - Holding your own news until your card has dealt it: a command holds
 *   before it sends (holdReveal), and the card releases the hold once the
 *   answer is all on the table.
 *
 *   putRound(result.round)                         // your answer, at once
 *   const round = useCardRound(message, fallback)  // in the card
 */
import { create } from 'zustand'

import type { ChatMessage } from '../../shared/chat.ts'
import { type RoundView, roundVersion } from '../../shared/rounds.ts'

interface CardRounds {
  /** Every round a card shows, by round id. */
  rounds: Readonly<Record<number, RoundView>>
  /** When each card finished showing its result, in epoch milliseconds. */
  shown: Readonly<Record<number, number>>
  /** Rounds this tab saw open, so their cards play the result out before they fold. */
  seenOpen: Readonly<Record<number, true>>
}

export const useCardRounds = create<CardRounds>(() => ({ rounds: {}, shown: {}, seenOpen: {} }))

/** Rounds kept; the oldest go first. The stream keeps fewer cards than this. */
const KEEP = 800

/** Puts a round in the store, if it is newer than the one there. */
export function putRound(round: RoundView): void {
  useCardRounds.setState((state) => {
    const known = state.rounds[round.id]
    const opened = round.status === 'open' && !state.seenOpen[round.id]
    const seenOpen = opened ? { ...state.seenOpen, [round.id]: true as const } : state.seenOpen
    if (known && roundVersion(round) <= roundVersion(known)) return opened ? { seenOpen } : state
    const rounds = { ...state.rounds, [round.id]: round }
    const ids = Object.keys(rounds)
    if (ids.length > KEEP) {
      for (const id of ids
        .map(Number)
        .sort((a, b) => a - b)
        .slice(0, ids.length - KEEP)) {
        delete rounds[id]
      }
    }
    return { rounds, seenOpen }
  })
}

/** The newest of the store's round and `fallback` (the one the card came with). */
export function useCardRound<D = unknown>(
  id: number,
  fallback: RoundView<D> | null | undefined,
): RoundView<D> | null {
  const stored = useCardRounds((s) => s.rounds[id]) as RoundView<D> | undefined
  if (!stored) return fallback ?? null
  if (fallback && roundVersion(fallback) > roundVersion(stored)) return fallback
  return stored
}

/** A card has shown its round's result: the shell folds it a few seconds after. */
export function markShown(roundId: number): void {
  if (useCardRounds.getState().shown[roundId]) return
  useCardRounds.setState((state) => ({ shown: { ...state.shown, [roundId]: Date.now() } }))
}

export function useShownAt(roundId: number): number | null {
  return useCardRounds((s) => s.shown[roundId] ?? null)
}

// ---------------------------------------------------------------- showing a card

let shower: ((card: ChatMessage) => void) | null = null

/** The stream's side: how a new card of yours goes in. */
export function onShowCard(show: (card: ChatMessage) => void): () => void {
  shower = show
  return () => {
    if (shower === show) shower = null
  }
}

/**
 * Shows a card your request just opened (PlayResult.card), without waiting
 * for its live echo: it goes in the stream, pins above the box and takes the
 * keys. Put its round in first (putRound).
 */
export function showCard(card: ChatMessage): void {
  shower?.(card)
}

// ---------------------------------------------------------------- the keys

interface CardKeys {
  /** The round whose card has the keys, or null while the message box has them. */
  roundId: number | null
  /** The keys that card answers to, as useShortcuts names them: "h", "Space". */
  claimed: readonly string[]
}

export const useCardKeys = create<CardKeys>(() => ({ roundId: null, claimed: [] }))

/** Gives the keys to a card: the message box lets go of them. */
export function giveKeys(roundId: number): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && active.closest('[data-composer]')) active.blur()
  useCardKeys.setState({ roundId })
}

/** The card's side: the keys it answers to while it has them. Any other key goes back to typing. */
export function claimKeys(keys: readonly string[]): void {
  useCardKeys.setState({ claimed: keys })
}

/** The message box takes the keys back. */
export function returnKeys(): void {
  if (useCardKeys.getState().roundId !== null) useCardKeys.setState({ roundId: null, claimed: [] })
}

// ---------------------------------------------------------------- your reveal

const holds = new Map<number, (forMs: number) => void>()

/** Hands a reveal hold (holdReveal) to the card of `roundId`, which releases it once shown. */
export function holdForCard(roundId: number, release: (forMs: number) => void): void {
  holds.get(roundId)?.(0)
  holds.set(roundId, release)
}

/** The card's side: takes the hold its command left, if any. */
export function takeCardHold(roundId: number): ((forMs: number) => void) | null {
  const release = holds.get(roundId) ?? null
  holds.delete(roundId)
  return release
}

// ---------------------------------------------------------------- refusals

/**
 * A command that cannot run: its text stays in the box and this sentence
 * shows just above it, for the player alone (spec: Commands).
 *
 *   if (!target) throw new CommandRefusal('Nobody called alice is playing.')
 */
export class CommandRefusal extends Error {
  override name = 'CommandRefusal'
}
