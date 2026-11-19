/**
 * The chat list in the query cache: the newest page, older pages added as
 * the player scrolls up, live messages added once, deletions removed.
 */
import type { ChatMessage, ChatPage } from '../../shared/chat.ts'

/** Messages kept in memory; older ones load again on scroll. */
export const CHAT_KEEP = 600

/**
 * The newest page fetched again (on open and after a resync), merged with
 * what is already loaded. Loaded older messages are kept when they join up
 * with the new page; a gap means too much was missed, so it starts over.
 */
export function mergeNewest(old: ChatPage | undefined, page: ChatPage): ChatPage {
  const first = page.messages[0]
  if (!old || !first) return page
  const lastOld = old.messages.at(-1)
  const joined = !page.more || (lastOld !== undefined && lastOld.id >= first.id)
  if (!joined) return page
  const older = old.messages.filter((m) => m.id < first.id)
  return { messages: [...older, ...page.messages], more: older.length ? old.more : page.more }
}

/** A message from the live feed or the API response, once, in id order. */
export function addMessage(old: ChatPage | undefined, message: ChatMessage): ChatPage | undefined {
  if (!old) return old
  if (old.messages.some((m) => m.id === message.id)) return old
  const messages = [...old.messages, message].sort((a, b) => a.id - b.id)
  const trimmed = messages.length > CHAT_KEEP ? messages.slice(-CHAT_KEEP) : messages
  return { messages: trimmed, more: old.more || trimmed.length < messages.length }
}

export function removeMessage(old: ChatPage | undefined, id: number): ChatPage | undefined {
  if (!old || !old.messages.some((m) => m.id === id)) return old
  return { ...old, messages: old.messages.filter((m) => m.id !== id) }
}

/** An older page from scrolling up, before what is loaded. */
export function addOlder(old: ChatPage | undefined, page: ChatPage): ChatPage | undefined {
  if (!old) return old
  const first = old.messages[0]
  const older = first ? page.messages.filter((m) => m.id < first.id) : page.messages
  return { messages: [...older, ...old.messages], more: page.more }
}
