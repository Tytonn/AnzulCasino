/**
 * Chat (spec: Social layer). One channel for everyone.
 *
 * Message kinds:
 * - `player`: a message someone typed. Plain text, never HTML (rule 10).
 * - `gif`: a GIF someone picked (Social layer > GIFs in chat). Its `meta`
 *   holds only Klipy's id and URLs (GifMeta); the image loads straight from
 *   Klipy. The server accepts URLs on Klipy's domains only. `body` holds the
 *   GIF's title, used as its alt text.
 * - `system`: a post from the site itself, such as a big win or a steal.
 */
import { z } from 'zod'

export const CHAT_KINDS = ['player', 'gif', 'system'] as const
export type ChatKind = (typeof CHAT_KINDS)[number]

/** Characters (code points) in one message. */
export const CHAT_MAX_LENGTH = 300

/** Messages in one page of GET /api/chat: the last 100 load on open. */
export const CHAT_PAGE_SIZE = 100

/** A chat message as the API and the `chat.message` event send it. */
export interface ChatMessage {
  id: number
  /** Null for a system post. */
  userId: string | null
  kind: ChatKind
  body: string
  /** GifMeta for a GIF, SystemMeta for a system post, else null. */
  meta: Record<string, unknown> | null
  createdAt: string
}

/**
 * `meta` of a `gif` message. The social lane owns the picker, the search
 * endpoint and the URL checks, and may add fields here as a shared change.
 */
export interface GifMeta {
  gif: {
    provider: 'klipy'
    /** Klipy's id for the GIF. */
    id: string
    /** The image or video to show, on a Klipy domain. */
    url: string
    /** A smaller version for the chat list, on a Klipy domain. */
    previewUrl?: string
    width: number
    height: number
  }
  /** The system post this GIF answers, such as a big win or a steal. */
  replyTo?: number
}

/**
 * `meta` of a `system` post. Lanes may add fields as a shared change.
 */
export interface SystemMeta {
  /** How it is drawn: gold for a win, red for a loss, plain otherwise. */
  tone?: 'win' | 'loss' | 'info'
  /** The player the post is about. */
  userId?: string
  /** The round it is about; the post links to its replay. */
  roundId?: number
  /** The game it is about, such as "coinflip". */
  game?: string
  /**
   * A chat drop (the economy lane's): its id, the pot, how many players
   * claimed a share and each share, in hundredths.
   */
  drop?: { id: number; pot: number; winners: number; share: number }
}

/** Bidirectional overrides can make a message read backwards. */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/g
const CONTROL_RUNS = /\p{Cc}+/gu

/**
 * A message as it is stored: one line of plain text, with control characters
 * and runs of spaces folded into single spaces. Emoji sequences are kept.
 */
export function cleanChatText(text: string): string {
  return text.replace(BIDI_CONTROLS, '').replace(CONTROL_RUNS, ' ').replace(/\s+/g, ' ').trim()
}

/** Length as people count it: an emoji is one character. */
export function chatLength(text: string): number {
  let count = 0
  for (const _ of text) count++
  return count
}

/** POST /api/chat */
export const ChatSendInput = z.strictObject({
  body: z
    .string('Type a message first.')
    .max(CHAT_MAX_LENGTH * 8, `Messages are up to ${CHAT_MAX_LENGTH} characters.`)
    .transform(cleanChatText)
    .pipe(
      z
        .string()
        .min(1, 'Type a message first.')
        .refine(
          (body) => chatLength(body) <= CHAT_MAX_LENGTH,
          `Messages are up to ${CHAT_MAX_LENGTH} characters.`,
        ),
    ),
})
export type ChatSendInput = z.infer<typeof ChatSendInput>

/** GET /api/chat: the newest page, or the page before a message id. */
export const ChatListInput = z.strictObject({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_PAGE_SIZE).optional(),
})
export type ChatListInput = z.infer<typeof ChatListInput>

/** GET /api/chat: oldest first. `more` is true when older messages exist. */
export interface ChatPage {
  messages: ChatMessage[]
  more: boolean
}

/** True when `body` mentions @username, in any case. */
export function mentions(body: string, username: string): boolean {
  const escaped = username.replace(/[^A-Za-z0-9_]/g, '')
  if (!escaped) return false
  return new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?![A-Za-z0-9_])`, 'i').test(body)
}
