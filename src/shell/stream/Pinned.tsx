/**
 * Your cards above the message box (spec: The stream > Pinned). A card of
 * yours sits here, in thumb reach, while its round is open and for a few
 * seconds after its result shows, so Space can deal again; then it lets go
 * and lives on in the stream. A shared card you have a bet on (a roulette
 * spin) pins the same way, through its countdown and its spin. A newer card
 * takes the place of a finished one at once. Two open at once both pin, the
 * older one as its header only. Clicking a pinned card gives it the keys.
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
  useSharedRound,
  useSharedRounds,
  useSharedShownAt,
  useShownAt,
} from '../../kit/cards.ts'
import { usePlaying, usePresenceRoom } from '../../live/index.ts'
import { CardItem, cardGame } from './CardItem.tsx'
import { cardRoundId, cardSharedRoundId, isSharedCard, SHARED_SHOW_LIMIT_MS } from './fold.ts'
import { PIN_HOLD_MS, unpinCard, usePins } from './pins.ts'

/** A finished card whose result never says it has shown lets go this long after it ends. */
const UNSHOWN_HOLD_MS = 15_000

function letGo(message: ChatMessage) {
  unpinCard(message.id)
  if (useCardKeys.getState().roundId === cardRoundId(message)) returnKeys()
}

/** How long a finished card stays, from when its result shows or, never shown, from now. */
function useLetGo(
  message: ChatMessage,
  state: {
    gone: boolean
    open: boolean
    newest: boolean
    shownAt: number | null
    /** How long a finished card that never says it has shown stays. */
    unshownMs: number
  },
) {
  const { gone, open, newest, shownAt, unshownMs } = state
  useEffect(() => {
    if (gone) {
      letGo(message)
      return
    }
    if (open) return
    // A newer card of yours is here: this finished one makes room at once.
    if (!newest) {
      letGo(message)
      return
    }
    const until = shownAt !== null ? shownAt + PIN_HOLD_MS : Date.now() + unshownMs
    const timer = setTimeout(() => letGo(message), Math.max(0, until - Date.now()))
    return () => clearTimeout(timer)
  }, [gone, open, newest, shownAt, unshownMs, message])
}

function PinnedCard({ message, newest }: { message: ChatMessage; newest: boolean }) {
  return isSharedCard(message) ? (
    <PinnedShared message={message} newest={newest} />
  ) : (
    <PinnedRound message={message} newest={newest} />
  )
}

/** A shared card you have a bet on (a roulette spin): no keys, since the box takes more bets. */
function PinnedShared({ message, newest }: { message: ChatMessage; newest: boolean }) {
  const id = cardSharedRoundId(message)
  const shared = useSharedRound(id, message.sharedRound)
  const shownAt = useSharedShownAt(id)
  // Drawn at the close, it still has its spin to play: up to the longest spin the settings allow.
  useLetGo(message, {
    gone: !shared,
    open: shared?.settledAt === null,
    newest,
    shownAt,
    unshownMs: SHARED_SHOW_LIMIT_MS,
  })
  if (!shared) return null
  return (
    <div data-pinned-shared={id}>
      <CardItem message={message} state="live" pinned collapsed={!newest} />
    </div>
  )
}

function PinnedRound({ message, newest }: { message: ChatMessage; newest: boolean }) {
  const roundId = cardRoundId(message)
  const round = useCardRound(roundId, message.round)
  const shownAt = useShownAt(roundId)
  const open = round?.status === 'open'
  useLetGo(message, { gone: !round, open, newest, shownAt, unshownMs: UNSHOWN_HOLD_MS })

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
  const shared = useSharedRounds((s) => s.rounds)
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i]
    if (!card) continue
    const open = isSharedCard(card)
      ? (shared[cardSharedRoundId(card)] ?? card.sharedRound)?.settledAt === null
      : (rounds[cardRoundId(card)] ?? card.round)?.status === 'open'
    if (open) return cardGame(card)?.id ?? null
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
