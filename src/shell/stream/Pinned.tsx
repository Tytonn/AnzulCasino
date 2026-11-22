/**
 * Your cards above the message box (spec: The stream > Pinned). A card of
 * yours sits here, in thumb reach, while its round is open and for a few
 * seconds after its result shows, so Space can deal again; then it lets go
 * and lives on in the stream. A newer card takes the place of a finished
 * one at once. Two open at once both pin, the older one as its header only.
 * Clicking a pinned card gives it the keys.
 *
 * While one of them is open, the online list says what you are playing.
 */
import { useEffect } from 'react'

import type { ChatMessage } from '../../../shared/chat.ts'
import {
  giveKeys,
  returnKeys,
  useCardKeys,
  useCardRound,
  useCardRounds,
  useShownAt,
} from '../../kit/cards.ts'
import { usePlaying, usePresenceRoom } from '../../live/index.ts'
import { CardItem, cardGame } from './CardItem.tsx'
import { cardRoundId } from './fold.ts'
import { PIN_HOLD_MS, unpinCard, usePins } from './pins.ts'

/** A finished card whose result never says it has shown lets go this long after it ends. */
const UNSHOWN_HOLD_MS = 15_000

function letGo(message: ChatMessage) {
  unpinCard(message.id)
  if (useCardKeys.getState().roundId === cardRoundId(message)) returnKeys()
}

function PinnedCard({ message, newest }: { message: ChatMessage; newest: boolean }) {
  const roundId = cardRoundId(message)
  const round = useCardRound(roundId, message.round)
  const shownAt = useShownAt(roundId)
  const open = round?.status === 'open'

  useEffect(() => {
    if (!round) {
      letGo(message)
      return
    }
    if (open) return
    // A newer card of yours is here: this finished one makes room at once.
    if (!newest) {
      letGo(message)
      return
    }
    const until = shownAt !== null ? shownAt + PIN_HOLD_MS : Date.now() + UNSHOWN_HOLD_MS
    const timer = setTimeout(() => letGo(message), Math.max(0, until - Date.now()))
    return () => clearTimeout(timer)
  }, [round, open, newest, shownAt, message])

  if (!round) return null
  return (
    <div
      data-pinned={roundId}
      onPointerDown={(event) => {
        const target = event.target as HTMLElement
        if (!target.closest('input, textarea')) giveKeys(roundId)
      }}
    >
      <CardItem message={message} state="live" pinned collapsed={!newest} />
    </div>
  )
}

/** The game of your newest open card, for the online list. */
function usePlayingGame(cards: readonly ChatMessage[]): string | null {
  const rounds = useCardRounds((s) => s.rounds)
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i]
    if (!card) continue
    const round = rounds[cardRoundId(card)] ?? card.round
    if (round?.status === 'open') return cardGame(card)?.id ?? null
  }
  return null
}

export function Pinned() {
  const cards = usePins((s) => s.cards)
  const playing = usePlayingGame(cards)
  usePresenceRoom(playing)
  usePlaying(playing !== null)

  if (cards.length === 0) return null
  return (
    <section aria-label="Your game" className="shrink-0 px-2 pb-1.5 md:px-4">
      <div className="mx-auto w-full max-w-3xl space-y-1.5">
        {cards.map((card, i) => (
          <PinnedCard key={card.id} message={card} newest={i === cards.length - 1} />
        ))}
      </div>
    </section>
  )
}
