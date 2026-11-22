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
 *
 * A round the whole table shares (a roulette spin) has one card for
 * everyone: its frame names the game, the round, the players and the chips
 * on it, and the game's `sharedCard` draws the rest. It folds to its own
 * line ("Roulette · Round 12 · 17 Black · 3 players").
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
import type { RoundView, SharedRoundView } from '../../../shared/rounds.ts'
import {
  markShown,
  markSharedShown,
  useCardKeys,
  useCardRound,
  useCardRounds,
  useSharedRound,
  useSharedShownAt,
  useShownAt,
} from '../../kit/cards.ts'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useMe, usePlayer } from '../../kit/queries.ts'
import type { CardProps, SharedCardProps } from '../manifests.ts'
import { type GameEntry, gameById, games } from '../registry.ts'
import { TOUCH, useMediaQuery } from '../media.ts'
import { Slot } from '../Slot.tsx'
import { useUi } from '../ui.ts'
import { cardRoundId, cardSharedRoundId, type CardState, isSharedCard } from './fold.ts'

type CardComponent = LazyExoticComponent<ComponentType<CardProps>>
type ReplayComponent = LazyExoticComponent<ComponentType<{ round: RoundView }>>
type SharedCardComponent = LazyExoticComponent<ComponentType<SharedCardProps>>
type SharedReplayComponent = LazyExoticComponent<ComponentType<{ shared: SharedRoundView }>>

/** Each game's cards and replays, loaded the first time one shows. */
const CARDS: Readonly<Record<string, CardComponent | undefined>> = Object.fromEntries(
  games.flatMap((game) => (game.manifest?.card ? [[game.id, lazy(game.manifest.card)]] : [])),
)
const REPLAYS: Readonly<Record<string, ReplayComponent | undefined>> = Object.fromEntries(
  games.flatMap((game) => (game.manifest?.replay ? [[game.id, lazy(game.manifest.replay)]] : [])),
)
const SHARED_CARDS: Readonly<Record<string, SharedCardComponent | undefined>> = Object.fromEntries(
  games.flatMap((game) =>
    game.manifest?.sharedCard ? [[game.id, lazy(game.manifest.sharedCard)]] : [],
  ),
)
const SHARED_REPLAYS: Readonly<Record<string, SharedReplayComponent | undefined>> =
  Object.fromEntries(
    games.flatMap((game) =>
      game.manifest?.sharedReplay ? [[game.id, lazy(game.manifest.sharedReplay)]] : [],
    ),
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

interface CardItemProps {
  message: ChatMessage
  state: CardState
  pinned?: boolean
  /** An older card pinned under a newer one: its header alone. */
  collapsed?: boolean
}

/** A live card, or a big result that stays open. */
export const CardItem = memo(function CardItem(props: CardItemProps) {
  return isSharedCard(props.message) ? <SharedCardItem {...props} /> : <RoundCardItem {...props} />
})

function RoundCardItem({ message, state, pinned = false, collapsed = false }: CardItemProps) {
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
}

/** A shared round's facts for its frame: the players, the chips on it, its line, your part. */
function sharedFacts(shared: SharedRoundView, me: string) {
  const players = new Set(shared.rounds.map((r) => r.userId)).size
  const total = shared.rounds.reduce((sum, r) => sum + r.stake, 0)
  const summary = shared.rounds.find((r) => r.summary)?.summary ?? null
  const mine = shared.rounds.filter((r) => r.userId === me)
  const myNet = mine.length > 0 ? mine.reduce((sum, r) => sum + net(r), 0) : null
  return { players, total, summary, mine: mine.length > 0, myNet }
}

function playerCount(players: number): string {
  return `${players} ${players === 1 ? 'player' : 'players'}`
}

/** A shared round's card (a roulette spin): one for everyone at the table. */
function SharedCardItem({ message, pinned = false, collapsed = false }: CardItemProps) {
  const me = useMe()
  const id = cardSharedRoundId(message)
  const shared = useSharedRound(id, message.sharedRound)
  const shownAt = useSharedShownAt(id)
  const game = cardGame(message)
  const Card = game ? SHARED_CARDS[game.id] : undefined

  if (!shared) return <SharedFoldedLine message={message} />
  // The draw comes before the wheel lands: the frame keeps the result until the card shows it.
  const told = shared.settledAt !== null && shownAt !== null
  const facts = sharedFacts(shared, me.id)

  return (
    <article
      data-card={game?.id ?? 'card'}
      data-shared={shared.id}
      data-status={shared.settledAt === null ? 'open' : 'settled'}
      aria-label={`${game?.name ?? 'A game'}, round ${shared.roundNo}`}
      className={`@container relative overflow-hidden rounded-lg border bg-surface-1 ${pinned ? 'border-accent/55 shadow-pop' : 'border-border'}`}
    >
      <header className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm">
        <span className="flex min-w-0 shrink items-center gap-1.5">
          {game && <game.icon className="size-4 shrink-0 text-muted" />}
          <span className="truncate font-semibold @max-[24rem]:sr-only">
            {game?.name ?? message.body}
          </span>
          <span className="shrink-0 text-muted">Round {shared.roundNo}</span>
        </span>
        <span className="shrink-0 text-faint">·</span>
        <span className="shrink-0 text-muted tabular-nums">
          <span className="@max-[20rem]:sr-only">{playerCount(facts.players)} · </span>
          {formatChips(facts.total)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs">
          {told ? (
            <>
              {facts.summary && (
                <span className="text-muted @max-[28rem]:hidden">{facts.summary}</span>
              )}
              {facts.myNet !== null && <Amount value={facts.myNet} />}
            </>
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
            <Card shared={shared} message={message} mine={facts.mine} pinned={pinned} />
          </Suspense>
        ) : (
          <PlainShared shared={shared} />
        ))}
      {!pinned && (
        <div className="empty:hidden px-3 pb-2">
          <Slot name="chat-message" props={{ message }} />
        </div>
      )}
    </article>
  )
}

/** The plain shared card for a game without its own: who is in, then what each took home. */
function PlainShared({ shared }: { shared: SharedRoundView }) {
  const done = shared.settledAt !== null
  useEffect(() => {
    if (done) markSharedShown(shared.id)
  }, [done, shared.id])
  return (
    <ul className="space-y-1 px-4 pb-3 text-sm">
      {shared.rounds.map((round) => (
        <li key={round.id} className="flex items-center gap-2">
          <FoldedOwner userId={round.userId} />
          <span className="ml-auto tabular-nums">
            {done ? <Amount value={net(round)} /> : formatChips(round.stake)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** A finished card as one line, which opens to the replay. In a run's list, without its player. */
export const FoldedLine = memo(function FoldedLine(props: {
  message: ChatMessage
  owner?: boolean
}) {
  return isSharedCard(props.message) ? (
    <SharedFoldedLine message={props.message} />
  ) : (
    <RoundFoldedLine {...props} />
  )
})

/** A finished shared round as one line ("Roulette · Round 12 · 17 Black · 3 players"), which opens to its result. */
function SharedFoldedLine({ message }: { message: ChatMessage }) {
  const me = useMe()
  const id = cardSharedRoundId(message)
  const shared = useSharedRound(id, message.sharedRound)
  const game = cardGame(message)
  const [open, setOpen] = useState(false)
  const Replay = game ? SHARED_REPLAYS[game.id] : undefined
  const facts = shared ? sharedFacts(shared, me.id) : null

  return (
    <div data-folded-shared={id} className="rounded-md border border-border/70 bg-surface-1/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
      >
        {game && <game.icon className="size-4 shrink-0 text-muted" />}
        <span className="min-w-0 truncate text-muted">
          {game?.name ?? 'Game'}
          {shared && <span className="text-text"> · Round {shared.roundNo}</span>}
          {facts?.summary && <span> · {facts.summary}</span>}
          {facts && <span> · {playerCount(facts.players)}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {facts?.myNet !== null && facts?.myNet !== undefined && shared?.settledAt && (
            <Amount value={facts.myNet} className="text-xs" />
          )}
          <Chevron open={open} />
        </span>
      </button>
      {open && shared && (
        <div className="border-t border-border/70 p-2">
          {Replay ? (
            <Suspense fallback={<div className="skeleton h-32" />}>
              <Replay shared={shared} />
            </Suspense>
          ) : (
            <PlainShared shared={shared} />
          )}
        </div>
      )}
    </div>
  )
}

function RoundFoldedLine({ message, owner = true }: { message: ChatMessage; owner?: boolean }) {
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
}

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
  const what = game
    ? roundWords(game.name, game.manifest?.roundName ?? ['round', 'rounds'], true)
    : 'rounds'
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
          {messages.length} {what}
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
  const what = game
    ? roundWords(game.name, game.manifest?.roundName ?? ['card', 'cards'], false).toLowerCase()
    : 'card'
  return (
    <p className="flex items-center gap-1.5 px-2 py-1 text-xs text-faint">
      <span aria-hidden="true">↓</span>
      Your {what} is pinned below
    </p>
  )
}

/**
 * A game's name with what its rounds are called: "Blackjack hands",
 * "Coin flips" (not "Coin flip flips": the name says it already).
 */
export function roundWords(name: string, noun: readonly [string, string], plural: boolean): string {
  const [one, many] = noun
  const word = plural ? many : one
  const lower = name.toLowerCase()
  if (lower === one || lower.endsWith(` ${one}`)) return `${name.slice(0, -one.length)}${word}`
  return `${name} ${word}`
}
