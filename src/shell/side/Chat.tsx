/**
 * Basic chat (spec: Social layer > Chat): one channel, plain text up to 300
 * characters, the last 100 on open and more on scrolling up, mentions
 * highlighted, system posts styled apart, GIFs shown, and admins can delete.
 * The social lane adds reactions and the GIF picker through the
 * `chat-message` and `chat-composer` slots.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  CHAT_MAX_LENGTH,
  type ChatMessage,
  type ChatPage,
  chatLength,
  type GifMeta,
  mentions,
  type SystemMeta,
} from '../../../shared/chat.ts'
import { api, errorMessage } from '../../kit/api.ts'
import { SendIcon } from '../../kit/icons.tsx'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { queryKeys, useMe, usePlayers } from '../../kit/queries.ts'
import { toast } from '../../kit/toast.tsx'
import type { PlayerSummary } from '../../../shared/players.ts'
import { addMessage, addOlder, mergeNewest, removeMessage } from '../chat-cache.ts'
import { Slot } from '../Slot.tsx'
import { useUi } from '../ui.ts'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
/** Messages from one player this close together share one header. */
const GROUP_MS = 5 * 60_000

export function useChat() {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: queryKeys.chat,
    queryFn: async () => {
      const page = await api.get<ChatPage>('/api/chat')
      return mergeNewest(queryClient.getQueryData<ChatPage>(queryKeys.chat), page)
    },
  })
}

export function Chat() {
  const me = useMe()
  const queryClient = useQueryClient()
  const { data, isPending, isError, refetch } = useChat()
  const { data: players } = usePlayers()
  const seeChat = useUi((s) => s.seeChat)
  const chatSeen = useUi((s) => s.chatSeen)
  const showProfile = useUi((s) => s.showProfile)

  const list = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const loadingOlder = useRef(false)
  const keepFromBottom = useRef<number | null>(null)

  const messages = useMemo(() => data?.messages ?? [], [data])
  const last = messages.at(-1)
  // A new message while scrolled up shows a pill instead of jumping.
  const unseenBelow = last !== undefined && last.id > chatSeen && last.userId !== me.id

  /** Your own message: show it at once and go to the bottom. */
  const sent = useCallback(
    (message: ChatMessage) => {
      atBottom.current = true
      queryClient.setQueryData<ChatPage>(queryKeys.chat, (old) => addMessage(old, message))
    },
    [queryClient],
  )

  // Older messages went in on top: keep the view where it was.
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current
      keepFromBottom.current = null
      return
    }
    if (atBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (last && atBottom.current) seeChat(last.id)
  }, [last, seeChat])

  async function loadOlder() {
    const first = data?.messages[0]
    if (!data?.more || !first || loadingOlder.current) return
    loadingOlder.current = true
    try {
      const page = await api.get<ChatPage>(`/api/chat?before=${first.id}`)
      const el = list.current
      if (el) keepFromBottom.current = el.scrollHeight - el.scrollTop
      queryClient.setQueryData<ChatPage>(queryKeys.chat, (old) => addOlder(old, page))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      loadingOlder.current = false
    }
  }

  function onScroll() {
    const el = list.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (atBottom.current && last) seeChat(last.id)
    if (el.scrollTop < 120) void loadOlder()
  }

  function jumpToEnd() {
    const el = list.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    if (last) seeChat(last.id)
  }

  async function remove(id: number) {
    try {
      await api.del(`/api/chat/${id}`)
      queryClient.setQueryData<ChatPage>(queryKeys.chat, (old) => removeMessage(old, id))
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div
          ref={list}
          onScroll={onScroll}
          className="scroll-quiet absolute inset-0 overflow-y-auto px-2 pb-2"
          aria-label="Chat messages"
          role="log"
        >
          {isPending && <ChatSkeleton />}
          {isError && (
            <p className="p-4 text-sm text-muted">
              Chat did not load.{' '}
              <button
                type="button"
                className="text-accent underline"
                onClick={() => void refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {data && !data.more && messages.length > 0 && (
            <p className="py-3 text-center text-xs text-faint">The start of chat.</p>
          )}
          {data && !messages.length && (
            <p className="p-6 text-center text-sm text-muted">
              It is quiet in here. Say hi to the table.
            </p>
          )}
          <ol>
            {messages.map((message, i) => {
              const previous = messages[i - 1]
              const grouped =
                message.kind !== 'system' &&
                previous !== undefined &&
                previous.kind !== 'system' &&
                previous.userId === message.userId &&
                Date.parse(message.createdAt) - Date.parse(previous.createdAt) < GROUP_MS
              return (
                <MessageRow
                  key={message.id}
                  message={message}
                  grouped={grouped}
                  player={players?.find((p) => p.id === message.userId)}
                  mentioned={message.userId !== me.id && mentions(message.body, me.username)}
                  canDelete={me.role === 'admin'}
                  onDelete={() => void remove(message.id)}
                  onShowProfile={showProfile}
                />
              )
            })}
          </ol>
        </div>
        <AnimatePresence>
          {unseenBelow && (
            <motion.button
              type="button"
              onClick={jumpToEnd}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-on-accent shadow-pop"
            >
              New messages
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <Composer onSent={sent} />
    </div>
  )
}

function MessageRow({
  message,
  grouped,
  player,
  mentioned,
  canDelete,
  onDelete,
  onShowProfile,
}: {
  message: ChatMessage
  grouped: boolean
  player: PlayerSummary | undefined
  mentioned: boolean
  canDelete: boolean
  onDelete: () => void
  onShowProfile: (userId: string) => void
}) {
  const time = timeFormat.format(new Date(message.createdAt))

  if (message.kind === 'system') {
    const meta = (message.meta ?? {}) as SystemMeta
    const tone =
      meta.tone === 'win'
        ? 'border-gold/40 text-gold'
        : meta.tone === 'loss'
          ? 'border-loss/40 text-loss'
          : 'border-border text-muted'
    return (
      <li className="group relative my-2 px-1" data-kind="system">
        <div
          className={`rounded-sm border bg-surface-2 px-3 py-2 text-center text-xs font-medium ${tone}`}
        >
          {message.body}
        </div>
        <Slot name="chat-message" props={{ message }} />
        {canDelete && <DeleteButton onDelete={onDelete} />}
      </li>
    )
  }

  return (
    <li
      className={`group relative rounded-sm px-2 ${grouped ? 'pt-0.5' : 'mt-2 pt-1'} ${mentioned ? 'bg-accent/12 shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-surface-2'}`}
      data-kind={message.kind}
    >
      <div className="flex gap-2.5">
        <div className="w-7 shrink-0">
          {!grouped && message.userId && (
            <button
              type="button"
              onClick={() => message.userId && onShowProfile(message.userId)}
              aria-label={`${player?.displayName ?? 'Someone'}: profile`}
              tabIndex={-1}
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
                onClick={() => message.userId && onShowProfile(message.userId)}
              >
                <PlayerName player={player} />
              </button>
              <time className="shrink-0 text-[0.7rem] text-faint" dateTime={message.createdAt}>
                {time}
              </time>
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
      {canDelete && <DeleteButton onDelete={onDelete} />}
    </li>
  )
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  const [sure, setSure] = useState(false)
  return (
    <button
      type="button"
      onClick={() => (sure ? onDelete() : setSure(true))}
      onBlur={() => setSure(false)}
      className={`absolute top-1 right-1 rounded-sm px-1.5 py-0.5 text-[0.7rem] font-medium opacity-0 group-hover:opacity-100 focus:opacity-100 ${sure ? 'bg-loss text-on-accent opacity-100' : 'bg-surface-3 text-muted hover:text-loss'}`}
    >
      {sure ? 'Delete?' : 'Delete'}
    </button>
  )
}

/** Only https images and videos, sized before they load so nothing jumps. */
function GifView({ message }: { message: ChatMessage }) {
  const gif = (message.meta as Partial<GifMeta> | null)?.gif
  const src = gif?.previewUrl ?? gif?.url
  if (!gif || !src || !src.startsWith('https://') || !(gif.width > 0) || !(gif.height > 0)) {
    return <p className="text-sm text-muted italic">[GIF: {message.body || 'untitled'}]</p>
  }
  const width = Math.min(240, gif.width)
  const style = { width, aspectRatio: `${gif.width} / ${gif.height}` }
  const isVideo = /\.(mp4|webm)(\?|$)/i.test(src)
  return (
    <div className="mt-1 overflow-hidden rounded-sm bg-surface-3" style={style}>
      {isVideo ? (
        <video
          src={src}
          autoPlay
          loop
          muted
          playsInline
          aria-label={message.body}
          className="size-full object-cover"
        />
      ) : (
        <img
          src={src}
          alt={message.body}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      )}
    </div>
  )
}

function Composer({ onSent }: { onSent: (message: ChatMessage) => void }) {
  const id = useId()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const length = chatLength(body.trim())
  const tooLong = length > CHAT_MAX_LENGTH

  async function send(event: FormEvent) {
    event.preventDefault()
    if (!body.trim() || tooLong || sending) return
    setSending(true)
    try {
      const { message } = await api.post<{ message: ChatMessage }>('/api/chat', { body })
      onSent(message)
      setBody('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={send} className="flex shrink-0 items-center gap-1.5 border-t border-border p-2">
      <Slot name="chat-composer" props={{ sent: onSent }} />
      <label className="sr-only" htmlFor={id}>
        Message
      </label>
      <div className="relative min-w-0 flex-1">
        <input
          id={id}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Say something nice"
          autoComplete="off"
          enterKeyHint="send"
          className="h-10 w-full rounded-md border border-border bg-surface-2 px-3 pr-12 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        {length > CHAT_MAX_LENGTH - 50 && (
          <span
            className={`absolute top-1/2 right-3 -translate-y-1/2 text-[0.7rem] tabular-nums ${tooLong ? 'text-loss' : 'text-faint'}`}
          >
            {CHAT_MAX_LENGTH - length}
          </span>
        )}
      </div>
      <button
        type="submit"
        disabled={!body.trim() || tooLong || sending}
        aria-label="Send"
        className="grid size-10 shrink-0 place-items-center rounded-md bg-accent text-on-accent transition hover:bg-accent-strong active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <SendIcon className="size-4" />
      </button>
    </form>
  )
}

function ChatSkeleton() {
  return (
    <div className="space-y-3 p-2" aria-label="Loading chat">
      {[70, 45, 85, 55].map((width, i) => (
        <div key={i} className="flex gap-2.5">
          <div className="skeleton size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-3" style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}
