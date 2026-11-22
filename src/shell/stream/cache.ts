/**
 * The stream in the query cache, one list for each filter (spec: The
 * stream): the newest page, older pages added on scrolling up, live items
 * added once wherever their filter shows them, deleted items removed.
 */
import {
  type ChatMessage,
  filterShows,
  type StreamFilter,
  type StreamPage,
  streamTopic,
} from '../../../shared/chat.ts'

/** Items kept in memory for each filter; older ones load again on scroll. */
export const STREAM_KEEP = 600

export const streamKey = (filter: StreamFilter) => ['stream', filter] as const

export interface StreamList {
  /** Oldest first. */
  items: ChatMessage[]
  /** Older items exist. */
  more: boolean
}

/**
 * The newest page fetched again (on open and after a resync), merged with
 * what is loaded. Older items are kept when they join up with the new page;
 * a gap means too much was missed, so the list starts over.
 */
export function mergeNewest(old: StreamList | undefined, page: StreamPage): StreamList {
  const first = page.items[0]
  if (!old || !first) return { items: page.items, more: page.more }
  const lastOld = old.items.at(-1)
  const joined = !page.more || (lastOld !== undefined && lastOld.id >= first.id)
  if (!joined) return { items: page.items, more: page.more }
  const older = old.items.filter((m) => m.id < first.id)
  return { items: [...older, ...page.items], more: older.length ? old.more : page.more }
}

/** A live or just-sent item, once, in id order, if this filter shows it. */
export function addItem(
  old: StreamList | undefined,
  item: ChatMessage,
  filter: StreamFilter,
): StreamList | undefined {
  if (!old || !filterShows(filter, streamTopic(item))) return old
  if (old.items.some((m) => m.id === item.id)) return old
  const items = [...old.items, item].sort((a, b) => a.id - b.id)
  const trimmed = items.length > STREAM_KEEP ? items.slice(-STREAM_KEEP) : items
  return { items: trimmed, more: old.more || trimmed.length < items.length }
}

export function removeItem(old: StreamList | undefined, id: number): StreamList | undefined {
  if (!old || !old.items.some((m) => m.id === id)) return old
  return { ...old, items: old.items.filter((m) => m.id !== id) }
}

/** An older page from scrolling up, before what is loaded. */
export function addOlder(old: StreamList | undefined, page: StreamPage): StreamList | undefined {
  if (!old) return old
  const first = old.items[0]
  const older = first ? page.items.filter((m) => m.id < first.id) : page.items
  return { items: [...older, ...old.items], more: page.more }
}
