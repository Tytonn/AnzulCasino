/**
 * The stream (spec: The stream): chat and games in one list, oldest at the
 * top. The newest page of the chosen filter loads in one request with each
 * card's round; live news keeps it current from there, and scrolling up
 * loads older items. While you are at the bottom it follows new items; when
 * you have scrolled up, a pill offers to jump down instead.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import {
  type ChatMessage,
  mentions,
  type StreamFilter,
  type StreamPage,
  type SystemMeta,
} from '../../../shared/chat.ts'
import { api, errorMessage } from '../../kit/api.ts'
import { useConfig, useMe } from '../../kit/queries.ts'
import { toast } from '../../kit/toast.tsx'
import { addOlder, mergeNewest, streamKey, type StreamList } from './cache.ts'
import { CardItem, FoldedLine, PinnedStub, RunLine } from './CardItem.tsx'
import { useCardStates } from './fold.ts'
import { IncomeItem, LookupItem, MessageItem, NewsItem, PrivateRow } from './items.tsx'
import { removeFromStream } from './live.ts'
import { pinCard, usePins } from './pins.ts'
import { usePrivate } from './private.ts'
import { buildRows, rowKey } from './rows.ts'
import { FILTER_LABELS, useStreamUi } from './ui.ts'

export function useStream(filter: StreamFilter) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: streamKey(filter),
    queryFn: async (): Promise<StreamList> => {
      const page = await api.get<StreamPage>(`/api/stream?filter=${filter}`)
      for (const card of page.mine) pinCard(card)
      return mergeNewest(queryClient.getQueryData<StreamList>(streamKey(filter)), page)
    },
  })
}

function SystemRow({
  message,
  canDelete,
  onDelete,
}: {
  message: ChatMessage
  canDelete: boolean
  onDelete: (id: number) => void
}) {
  const meta = (message.meta ?? {}) as SystemMeta
  if (meta.income) return <IncomeItem message={message} income={meta.income} />
  if (meta.lookup) return <LookupItem message={message} lookup={meta.lookup} />
  return <NewsItem message={message} canDelete={canDelete} onDelete={onDelete} />
}

export function Stream() {
  const me = useMe()
  const queryClient = useQueryClient()
  const filter = useStreamUi((s) => s.filter)
  const seen = useStreamUi((s) => s.seen)
  const see = useStreamUi((s) => s.see)
  const { data, isPending, isError, refetch } = useStream(filter)
  const privates = usePrivate((s) => s.items)
  const pins = usePins((s) => s.cards)
  const foldRuns = (useConfig().data?.stream_round_runs ?? 'fold') === 'fold'

  const items = useMemo(() => data?.items ?? [], [data])
  const states = useCardStates(items)
  const pinned = useMemo(() => new Set(pins.map((c) => c.id)), [pins])
  const rows = useMemo(
    () => buildRows({ items, privates, states, pinned, foldRuns }),
    [items, privates, states, pinned, foldRuns],
  )

  const list = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLOListElement>(null)
  const atBottom = useRef(true)
  const loadingOlder = useRef(false)
  const keepFromBottom = useRef<number | null>(null)

  const last = items.at(-1)
  const unseenBelow = last !== undefined && last.id > seen && last.userId !== me.id

  // A new filter starts at the bottom, and so does whatever you just sent.
  const bottom = useStreamUi((s) => s.bottom)
  useLayoutEffect(() => {
    atBottom.current = true
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [filter, bottom])

  // Older items went in on top: keep the view where it was. Otherwise follow the bottom.
  useLayoutEffect(() => {
    const el = list.current
    if (!el) return
    if (keepFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - keepFromBottom.current
      keepFromBottom.current = null
      return
    }
    if (atBottom.current) el.scrollTop = el.scrollHeight
  }, [rows])

  // Cards grow as they deal and shrink as they fold: stay at the bottom through it.
  useEffect(() => {
    const el = list.current
    const inner = content.current
    if (!el || !inner) return
    const observer = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (last && atBottom.current) see(last.id)
  }, [last, see])

  const loadOlder = useCallback(async () => {
    const first = data?.items[0]
    if (!data?.more || !first || loadingOlder.current) return
    loadingOlder.current = true
    try {
      const page = await api.get<StreamPage>(`/api/stream?filter=${filter}&before=${first.id}`)
      const el = list.current
      if (el) keepFromBottom.current = el.scrollHeight - el.scrollTop
      queryClient.setQueryData<StreamList>(streamKey(filter), (old) => addOlder(old, page))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      loadingOlder.current = false
    }
  }, [data, filter, queryClient])

  function onScroll() {
    const el = list.current
    if (!el) return
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (atBottom.current && last) see(last.id)
    if (el.scrollTop < 240) void loadOlder()
  }

  function jumpToEnd() {
    const el = list.current
    if (!el) return
    atBottom.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    if (last) see(last.id)
  }

  const remove = useCallback(
    async (id: number) => {
      try {
        await api.del(`/api/chat/${id}`)
        removeFromStream(queryClient, id)
      } catch (error) {
        toast.error(errorMessage(error))
      }
    },
    [queryClient],
  )

  const admin = me.role === 'admin'
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={list}
        onScroll={onScroll}
        className="scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain"
        role="log"
        aria-label={`The stream: ${FILTER_LABELS[filter]}`}
      >
        <ol
          ref={content}
          className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end px-2 pt-2 pb-3 md:px-4"
        >
          {isPending && <StreamSkeleton />}
          {isError && (
            <li className="p-4 text-sm text-muted">
              The stream did not load.{' '}
              <button
                type="button"
                className="text-accent underline"
                onClick={() => void refetch()}
              >
                Try again
              </button>
            </li>
          )}
          {data && !data.more && items.length > 0 && (
            <li className="py-3 text-center text-xs text-faint">The start of the stream.</li>
          )}
          {data && items.length === 0 && privates.length === 0 && (
            <li className="p-6 text-center text-sm text-muted">
              {filter === 'games'
                ? 'No games yet. Type .bj 50 to deal the first hand.'
                : 'It is quiet in here. Say hi, or type . to see the commands.'}
            </li>
          )}
          {rows.map((row) => (
            <Fragment key={rowKey(row)}>
              <li
                className={
                  row.kind === 'card' || row.kind === 'run' || row.kind === 'stub'
                    ? 'my-1.5 max-w-2xl'
                    : ''
                }
                data-row={row.kind}
              >
                {row.kind === 'message' && (
                  <MessageItem
                    message={row.message}
                    grouped={row.grouped}
                    mentioned={
                      row.message.userId !== me.id && mentions(row.message.body, me.username)
                    }
                    canDelete={admin}
                    onDelete={(id) => void remove(id)}
                  />
                )}
                {row.kind === 'system' && (
                  <SystemRow
                    message={row.message}
                    canDelete={admin}
                    onDelete={(id) => void remove(id)}
                  />
                )}
                {row.kind === 'card' &&
                  (row.state === 'folded' ? (
                    <FoldedLine message={row.message} />
                  ) : (
                    <CardItem message={row.message} state={row.state} />
                  ))}
                {row.kind === 'stub' && <PinnedStub message={row.message} />}
                {row.kind === 'run' && <RunLine messages={row.messages} />}
                {row.kind === 'private' && <PrivateRow item={row.item} />}
              </li>
            </Fragment>
          ))}
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
            className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-on-accent shadow-pop"
          >
            New in the stream ↓
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

function StreamSkeleton() {
  return (
    <li className="space-y-3 p-2" aria-label="Loading the stream">
      {[70, 45, 85, 55].map((width, i) => (
        <div key={i} className="flex gap-2.5">
          <div className="skeleton size-7 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-3" style={{ width: `${width}%` }} />
          </div>
        </div>
      ))}
      <div className="skeleton h-44 max-w-2xl" />
    </li>
  )
}
