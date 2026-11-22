/**
 * Everything in the stream that is not a card: players' messages and GIFs,
 * announcements, the one-line work, slut and crime results (Tyton, Nov 22,
 * 2026: "tyton worked as a mildly successful content creator and earned
 * 59"), public .bal and .lb posts, and your private replies. Names and
 * messages render as plain text, never as HTML. Features add to each item
 * through the `chat-message` slot, such as reactions and the Grab button
 * under a drop.
 */
import { memo, type ReactNode } from 'react'

import {
  type ChatMessage,
  type IncomeLine,
  type LookupSnapshot,
  retellLine,
  type SystemMeta,
} from '../../../shared/chat.ts'
import { formatChips } from '../../../shared/chips.ts'
import { CloseIcon } from '../../kit/icons.tsx'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useConfig, usePlayer } from '../../kit/queries.ts'
import { DeleteButton, GifView } from '../side/Chat.tsx'
import { Slot } from '../Slot.tsx'
import { useUi } from '../ui.ts'
import { BalanceView, BoardView } from './lookups.tsx'
import { dismissPrivate, type PrivateItem } from './private.ts'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function Time({ at }: { at: string }) {
  return (
    <time className="shrink-0 text-[0.7rem] text-faint" dateTime={at}>
      {timeFormat.format(new Date(at))}
    </time>
  )
}

export const MessageItem = memo(function MessageItem({
  message,
  grouped,
  mentioned,
  canDelete,
  onDelete,
}: {
  message: ChatMessage
  grouped: boolean
  mentioned: boolean
  canDelete: boolean
  onDelete: (id: number) => void
}) {
  const player = usePlayer(message.userId)
  const showProfile = useUi((s) => s.showProfile)
  return (
    <div
      data-kind={message.kind}
      className={`group relative rounded-sm px-2 ${grouped ? 'pt-0.5' : 'mt-1.5 pt-1'} ${mentioned ? 'bg-accent/12 shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-surface-2/70'}`}
    >
      <div className="flex gap-2.5">
        <div className="w-7 shrink-0">
          {!grouped && message.userId && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => message.userId && showProfile(message.userId)}
              aria-label={`${player?.displayName ?? 'Someone'}: profile`}
            >
              <Avatar player={player} size="sm" />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1 pb-0.5">
          {!grouped && (
            <div className="flex items-baseline gap-2 text-sm">
              <button
                type="button"
                className="min-w-0 truncate hover:underline"
                onClick={() => message.userId && showProfile(message.userId)}
              >
                <PlayerName player={player} />
              </button>
              <Time at={message.createdAt} />
            </div>
          )}
          {mentioned && <span className="sr-only">Mentions you:</span>}
          {message.kind === 'gif' ? (
            <GifView message={message} />
          ) : (
            <p className="text-sm break-words whitespace-pre-wrap text-text">{message.body}</p>
          )}
          <Slot name="chat-message" props={{ message }} />
        </div>
      </div>
      {canDelete && <DeleteButton onDelete={() => onDelete(message.id)} />}
    </div>
  )
})

/** An announcement: a drop, the season's news, a rank bought, an admin's post. */
export const NewsItem = memo(function NewsItem({
  message,
  canDelete,
  onDelete,
}: {
  message: ChatMessage
  canDelete: boolean
  onDelete: (id: number) => void
}) {
  const meta = (message.meta ?? {}) as SystemMeta
  const tone =
    meta.tone === 'win'
      ? 'border-gold/40 text-gold'
      : meta.tone === 'loss'
        ? 'border-loss/40 text-loss'
        : 'border-border text-muted'
  return (
    <div className="group relative my-1.5 px-1" data-kind="system">
      <div
        className={`rounded-sm border bg-surface-2 px-3 py-2 text-center text-xs font-medium ${tone}`}
      >
        {message.body}
      </div>
      <Slot name="chat-message" props={{ message }} />
      {canDelete && <DeleteButton onDelete={() => onDelete(message.id)} />}
    </div>
  )
})

const COMMAND_TONE: Record<IncomeLine['command'], string> = {
  work: 'var(--economy-work, var(--accent))',
  hustle: 'var(--economy-hustle, var(--accent))',
  crime: 'var(--economy-crime, var(--accent))',
}

/** Splits a retold line around the player's name, so the name can draw as a name. */
const NAME = '\u0000'

/** A work, slut or crime result: one line, the name, the flavor line and the amount. */
export const IncomeItem = memo(function IncomeItem({
  message,
  income,
}: {
  message: ChatMessage
  income: IncomeLine
}) {
  const meta = (message.meta ?? {}) as SystemMeta
  const userId = meta.userId ?? null
  const player = usePlayer(userId)
  const showProfile = useUi((s) => s.showProfile)
  const hustleName = useConfig().data?.hustle_name ?? 'Slut'
  const label =
    income.command === 'work' ? 'Work' : income.command === 'crime' ? 'Crime' : hustleName
  const paid = income.outcome === 'paid'
  const parts = retellLine(income.line, NAME).split(NAME)
  const name = (
    <button
      type="button"
      onClick={() => userId && showProfile(userId)}
      className="font-semibold hover:underline"
    >
      <PlayerName player={player} badge={false} />
    </button>
  )
  return (
    <div
      data-kind="income"
      className={`group relative my-1 rounded-md px-2 py-1.5 ${income.big ? 'border border-gold/50 bg-gold/8 card-glow-gold' : 'hover:bg-surface-2/70'}`}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => userId && showProfile(userId)}
          aria-label={`${player?.displayName ?? 'Someone'}: profile`}
          className="mt-px shrink-0"
        >
          <Avatar player={player} size="sm" />
        </button>
        <p className="min-w-0 flex-1 pt-1 text-sm leading-snug text-text">
          {parts.length > 1 ? (
            parts.map((part, i) => (
              <span key={i}>
                {i > 0 && name}
                {part}
              </span>
            ))
          ) : (
            <>
              {name} {parts[0]}
            </>
          )}
        </p>
        <span className="mt-1 flex shrink-0 items-center gap-2">
          <span
            className="rounded-full px-1.5 py-0.5 text-[0.62rem] font-bold tracking-[0.06em] uppercase"
            style={{
              color: COMMAND_TONE[income.command],
              backgroundColor: `color-mix(in oklab, ${COMMAND_TONE[income.command]} 14%, transparent)`,
            }}
          >
            {label}
          </span>
          <span
            className={`text-sm font-bold tabular-nums ${paid ? 'text-gold' : 'text-loss'}`}
            aria-label={
              paid ? `earned ${formatChips(income.amount)}` : `fined ${formatChips(income.amount)}`
            }
          >
            {paid ? '+' : '−'}
            {formatChips(income.amount)}
          </span>
        </span>
      </div>
      <div className="pl-9.5">
        <Slot name="chat-message" props={{ message }} />
      </div>
    </div>
  )
})

/** A .bal or .lb posted for everyone, with the asker and what it showed then. */
export const LookupItem = memo(function LookupItem({
  message,
  lookup,
}: {
  message: ChatMessage
  lookup: LookupSnapshot
}) {
  const meta = (message.meta ?? {}) as SystemMeta
  const asker = usePlayer(meta.userId ?? null)
  const about = usePlayer(lookup.kind === 'balance' ? lookup.userId : null)
  const self = lookup.kind === 'balance' && lookup.userId === meta.userId
  return (
    <div data-kind="lookup" className="group relative my-1.5">
      <div className="rounded-md border border-border bg-surface-1 px-3 py-2">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
          <Avatar player={asker} size="xs" />
          <PlayerName player={asker} badge={false} />
          {lookup.kind === 'leaderboard'
            ? 'checked the leaderboard'
            : self
              ? 'checked their balance'
              : `checked ${about?.displayName ?? 'a player'}`}
          <span className="ml-auto">
            <Time at={message.createdAt} />
          </span>
        </p>
        {lookup.kind === 'leaderboard' ? (
          <BoardView lookup={lookup} />
        ) : (
          <BalanceView lookup={lookup} />
        )}
      </div>
      <Slot name="chat-message" props={{ message }} />
    </div>
  )
})

/** A reply for you alone, marked so, and never stored. */
export function PrivateRow({ item }: { item: PrivateItem }): ReactNode {
  return (
    <div
      data-kind="private"
      className="relative my-1.5 rounded-md border border-dashed border-border-strong bg-surface-1/70 px-3 py-2"
    >
      <p className="mb-1 flex items-center gap-1.5 pr-6 text-[0.7rem] font-semibold tracking-[0.06em] text-faint uppercase">
        Only you · {item.reply.label}
      </p>
      <div className="text-sm text-text">{item.reply.content}</div>
      <button
        type="button"
        onClick={() => dismissPrivate(item.id)}
        aria-label="Dismiss"
        className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-text"
      >
        <CloseIcon className="size-3.5" />
      </button>
    </div>
  )
}
