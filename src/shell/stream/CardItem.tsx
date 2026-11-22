/**
 * A round's card in the stream (spec: The stream > Cards). The shell draws
 * the frame: who is playing, the game, the bet, an ALL IN or BIG BET tag
 * that glows until the outcome, and the result once it is in. The game
 * draws what goes inside (its manifest's `card`), for everyone watching,
 * with buttons that work only for the round's player. A game without a card
 * gets a plain one with the bet and the result.
 *
 * Finished cards fold to one line ("Bob · Blackjack 50 · Bust −50") that
 * expands to the replay, and a run of them by one player folds into one
 * line ("Bob · 6 hands · +45") while the stream_round_runs setting says so.
 */
import {
  type ComponentType,
  lazy,
  type LazyExoticComponent,
  memo,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from 'react'
import { useShallow } from 'zustand/react/shallow'

import type { CardMeta, ChatMessage } from '../../../shared/chat.ts'
import { formatChips } from '../../../shared/chips.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { markShown, useCardKeys, useCardRound, useCardRounds, useShownAt } from '../../kit/cards.ts'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useMe, usePlayer } from '../../kit/queries.ts'
import type { CardProps } from '../manifests.ts'
import { type GameEntry, gameById, games } from '../registry.ts'
import { TOUCH, useMediaQuery } from '../media.ts'
import { Slot } from '../Slot.tsx'
import { useUi } from '../ui.ts'
import { cardRoundId, type CardState } from './fold.ts'

type CardComponent = LazyExoticComponent<ComponentType<CardProps>>
type ReplayComponent = LazyExoticComponent<ComponentType<{ round: RoundView }>>

/** Each game's card and replay, loaded the first time one shows. */
const CARDS: Readonly<Record<string, CardComponent | undefined>> = Object.fromEntries(
  games.flatMap((game) => (game.manifest?.card ? [[game.id, lazy(game.manifest.card)]] : [])),
)
const REPLAYS: Readonly<Record<string, ReplayComponent | undefined>> = Object.fromEntries(
  games.flatMap((game) => (game.manifest?.replay ? [[game.id, lazy(game.manifest.replay)]] : [])),
)

export function cardGame(message: ChatMessage): GameEntry | undefined {
  return gameById((message.meta as Partial<CardMeta> | null)?.game)
}

function net(round: RoundView): number {
  return (round.payout ?? 0) - round.stake
}

function signed(amount: number): string {
  if (amount > 0) return `+${formatChips(amount)}`
  if (amount < 0) return `−${formatChips(-amount)}`
  return '±0'
}

function Amount({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span
      className={`font-semibold tabular-nums ${value > 0 ? 'text-gold' : value < 0 ? 'text-loss' : 'text-muted'} ${className}`}
    >
      {signed(value)}
    </span>
  )
}

/** ALL IN or BIG BET, glowing until the card shows the outcome. */
function StakeTag({ round, glow }: { round: RoundView; glow: boolean }) {
  if (!round.allIn && !round.bigBet) return null
  return (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.62rem] font-extrabold tracking-[0.08em] whitespace-nowrap uppercase ${round.allIn ? 'bg-loss/15 text-loss' : 'bg-gold/15 text-gold'} ${glow ? 'tag-glow' : ''}`}
    >
      {round.allIn ? 'All in' : 'Big bet'}
    </span>
  )
}

function Owner({ userId, size = 'sm' }: { userId: string | null; size?: 'xs' | 'sm' }) {
  const player = usePlayer(userId)
  const showProfile = useUi((s) => s.showProfile)
  return (
    <button
      type="button"
      onClick={() => userId && showProfile(userId)}
      className="flex max-w-[45%] min-w-0 shrink-0 items-center gap-2 hover:underline"
    >
      <Avatar player={player} size={size} />
      <PlayerName player={player} badge={size === 'sm'} />
    </button>
  )
}

/** The plain card for a game without its own: the bet, then the result. */
function PlainCard({ round }: { round: RoundView }) {
  useEffect(() => {
    if (round.status !== 'open') markShown(round.id)
  }, [round.id, round.status])
  return (
    <p className="px-4 pb-3 text-sm text-muted">
      {round.status === 'open' ? 'In play…' : (round.summary ?? 'Finished')}
    </p>
  )
}

function CardSkeleton() {
  return <div className="skeleton mx-3 mb-3 h-40" aria-label="Loading the card" />
}

/** A live card, or a big result that stays open. */
export const CardItem = memo(function CardItem({
  message,
  state,
  pinned = false,
  collapsed = false,
}: {
  message: ChatMessage
  state: CardState
  pinned?: boolean
  /** An older card pinned under a newer one: its header alone. */
  collapsed?: boolean
}) {
  const me = useMe()
  const roundId = cardRoundId(message)
  const round = useCardRound(roundId, message.round)
  const keys = useCardKeys((s) => s.roundId === roundId && roundId !== 0)
  // On a touch screen the keys mean nothing: the card says it is live, as for everyone.
  const touch = useMediaQuery(TOUCH)
  const game = cardGame(message)
  const Card = game ? CARDS[game.id] : undefined
  const mine = message.userId === me.id
  const shownAt = useShownAt(roundId)

  if (!round) return <FoldedLine message={message} />
  // The server's answer comes before the card has played it out: the header
  // and the glow keep the result until the felt has shown it.
  const told = round.status !== 'open' && shownAt !== null
  const result = net(round)
  const edge =
    state === 'big' && told
      ? result > 0
        ? 'border-gold/70 card-glow-gold'
        : 'border-loss/60 card-glow-loss'
      : pinned
        ? 'border-accent/55 shadow-pop'
        : 'border-border'

  return (
    <article
      data-card={game?.id ?? 'card'}
      data-round={round.id}
      data-status={round.status}
      aria-label={`${game?.name ?? 'A game'}, ${formatChips(round.stake)}`}
      className={`@container relative overflow-hidden rounded-lg border bg-surface-1 ${edge}`}
    >
      <header className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm">
        <Owner userId={message.userId} />
        <span className="shrink-0 text-faint">·</span>
        <span className="flex min-w-0 shrink items-center gap-1.5 text-muted">
          {game && <game.icon className="size-4 shrink-0" />}
          <span className="truncate @max-[24rem]:sr-only">{game?.name ?? message.body}</span>
          <span className="shrink-0 font-semibold text-text tabular-nums">
            {formatChips(round.stake)}
          </span>
        </span>
        <StakeTag round={round} glow={!told} />
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
          {told ? (
            <>
              {/* The felt says it in full on a narrow card. */}
              <span className="text-muted @max-[32rem]:hidden">{round.summary}</span>
              <Amount value={result} />
            </>
          ) : keys && !touch ? (
            <span className="text-accent">Your keys</span>
          ) : (
            <span className="flex items-center gap-1.5 text-online">
              <span className="size-1.5 animate-pulse rounded-full bg-online" />
              live
            </span>
          )}
        </span>
      </header>
      {!collapsed &&
        (Card ? (
          <Suspense fallback={<CardSkeleton />}>
            <Card round={round} message={message} mine={mine} pinned={pinned} keys={keys} />
          </Suspense>
        ) : (
          <PlainCard round={round} />
        ))}
      {!pinned && (
        <div className="empty:hidden px-3 pb-2">
          <Slot name="chat-message" props={{ message }} />
        </div>
      )}
    </article>
  )
})

/** A finished card as one line, which opens to the replay. In a run's list, without its player. */
export const FoldedLine = memo(function FoldedLine({
  message,
  owner = true,
}: {
  message: ChatMessage
  owner?: boolean
}) {
  const roundId = cardRoundId(message)
  const round = useCardRound(roundId, message.round)
  const game = cardGame(message)
  const [open, setOpen] = useState(false)
  const Replay = game ? REPLAYS[game.id] : undefined

  return (
    <div data-folded={roundId} className="rounded-md border border-border/70 bg-surface-1/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
      >
        {owner && (
          <>
            <FoldedOwner userId={message.userId} />
            <span className="text-faint">·</span>
          </>
        )}
        <span className="min-w-0 truncate text-muted">
          {game?.name ?? 'Game'}{' '}
          {round && <span className="text-text tabular-nums">{formatChips(round.stake)}</span>}
          {round?.summary && <span> · {round.summary}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {round && round.status !== 'open' && <Amount value={net(round)} className="text-xs" />}
          <Chevron open={open} />
        </span>
      </button>
      {open && round && (
        <div className="border-t border-border/70 p-2">
          {Replay ? (
            <Suspense fallback={<div className="skeleton h-32" />}>
              <Replay round={round} />
            </Suspense>
          ) : (
            <p className="px-1 text-sm text-muted">{round.summary ?? 'Finished'}</p>
          )}
        </div>
      )}
    </div>
  )
})

function FoldedOwner({ userId }: { userId: string | null }) {
  const player = usePlayer(userId)
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1.5">
      <Avatar player={player} size="xs" />
      <PlayerName player={player} badge={false} className="max-w-[9rem]" />
    </span>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`size-3.5 text-faint transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

/** Several finished rounds in a row by one player, as one line. */
export const RunLine = memo(function RunLine({ messages }: { messages: readonly ChatMessage[] }) {
  const [open, setOpen] = useState(false)
  const rounds = useRunRounds(messages)
  const first = messages[0]
  if (!first) return null
  const games = new Set(messages.map((m) => cardGame(m)?.id ?? ''))
  const game = games.size === 1 ? cardGame(first) : undefined
  const total = rounds.reduce((sum, r) => sum + (r ? net(r) : 0), 0)
  const noun = game?.manifest?.roundName ?? ['round', 'rounds']
  return (
    <div
      data-rounds={messages.map(cardRoundId).join(' ')}
      className="rounded-md border border-border/70 bg-surface-1/60"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
      >
        <FoldedOwner userId={first.userId} />
        <span className="text-faint">·</span>
        <span className="min-w-0 truncate text-muted">
          {messages.length} {game ? `${game.name} ` : ''}
          {noun[1]}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Amount value={total} className="text-xs" />
          <Chevron open={open} />
        </span>
      </button>
      {open && (
        <ol className="space-y-1 border-t border-border/70 p-1.5">
          {messages.map((m) => (
            <li key={m.id}>
              <FoldedLine message={m} owner={false} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
})

/** The rounds of a run, in one subscription: they are finished, so they rarely change. */
function useRunRounds(messages: readonly ChatMessage[]): (RoundView | null)[] {
  const stored = useCardRounds(useShallow((s) => messages.map((m) => s.rounds[cardRoundId(m)])))
  return messages.map((m, i) => stored[i] ?? m.round ?? null)
}

/** Where your pinned card sits in the stream: a slim line pointing at it. */
export function PinnedStub({ message }: { message: ChatMessage }): ReactNode {
  const game = cardGame(message)
  const noun = game?.manifest?.roundName?.[0] ?? 'card'
  return (
    <p className="flex items-center gap-1.5 px-2 py-1 text-xs text-faint">
      <span aria-hidden="true">↓</span>
      Your {game ? `${game.name.toLowerCase()} ` : ''}
      {noun} is pinned below
    </p>
  )
}
