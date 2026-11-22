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
 * - `card`: a game in the stream (spec: The stream). Its `meta` points at the
 *   round it shows (CardMeta), and the round stays the truth: the stream API
 *   and the `chat.message` event send the round's public view with it. The
 *   round helper writes one with every round a player starts.
 *
 * The stream shows chat and games in one list, and its filters (Everything,
 * Chat only, Games only) ask the server for one `topic` or another; see
 * streamTopic().
 */
import { z } from 'zod'

import type { RoundView } from './rounds.ts'

export const CHAT_KINDS = ['player', 'gif', 'system', 'card'] as const
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
  /** GifMeta for a GIF, SystemMeta for a system post, CardMeta for a card, else null. */
  meta: Record<string, unknown> | null
  createdAt: string
  /**
   * A card's round as it stands, without its secret: in GET /api/stream and
   * in the card's `chat.message` event. Newer news of it comes on the round's
   * room events, which win by their version.
   */
  round?: RoundView | null
}

/** `meta` of a `card`: the game and the round it shows. */
export interface CardMeta {
  game: string
  roundId: number
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
   * claimed a share and each share, in chips.
   */
  drop?: { id: number; pot: number; winners: number; share: number }
  /**
   * Which filter shows it besides Everything: `game` for a game's news
   * (a steal, a work or crime result), shown under Games only; `news`, the
   * default, for an announcement, shown under every filter.
   */
  category?: 'game' | 'news'
  /** About a round that has its own card in the stream: the stream leaves the post out. */
  onCard?: true
  /** A work, slut or crime result, posted for everyone (Tyton, Nov 22, 2026). */
  income?: IncomeLine
  /** A balance or the leaderboard, posted when stream_bal_lb is public. */
  lookup?: LookupSnapshot
}

/** A work, slut ("hustle") or crime result, as the stream draws it. */
export interface IncomeLine {
  command: 'work' | 'hustle' | 'crime'
  outcome: 'paid' | 'fined'
  /** Chips won or lost. */
  amount: number
  /** The flavor line shown with it. */
  line: string
  /** A crime that pays crime_chat_min or more: drawn bigger. */
  big: boolean
}

/** What .bal or .lb showed, as it stood when posted, in whole chips. */
export type LookupSnapshot =
  | {
      kind: 'balance'
      userId: string
      balance: number
      vault: number
      tier: string
      /** Place on the leaderboard, 1 for first. */
      rank: number | null
    }
  | {
      kind: 'leaderboard'
      /** The top of the board, first place first. */
      rows: { userId: string; rank: number; netWorth: number }[]
      /** How many players the board has. */
      players: number
    }

/** Where an item belongs in the stream, or null when the stream leaves it out. */
export type StreamTopic = 'chat' | 'game' | 'news'

export function streamTopic(message: Pick<ChatMessage, 'kind' | 'meta'>): StreamTopic | null {
  if (message.kind === 'player' || message.kind === 'gif') return 'chat'
  if (message.kind === 'card') return 'game'
  const meta = (message.meta ?? {}) as SystemMeta
  if (meta.onCard) return null
  return meta.category === 'game' ? 'game' : 'news'
}

/** Words after "you" that make it the subject of its clause ("you were", "you paid"). */
const SUBJECT_NEXT = new Set(
  (
    'was were are am could would should might must can will may had have has did do does ' +
    'thought paid got went made lost found took saw said kept left won ran sat sold told felt ' +
    'fell caught bought brought spent sent put cut hit let set heard held stood knew threw drew ' +
    'wore tore broke spoke woke chose rose drove rode wrote ate gave forgot began sang rang swam ' +
    'drank came became met led fed fled slept swept dealt meant built lent bent sank shook stole ' +
    'froze hid bit lit slid spun stuck struck hung dug swung shot'
  ).split(' '),
)
/** A verb that changes once the name is its subject: "you were" is "tyton was". */
const NAMED_VERB: Record<string, string> = { were: 'was', are: 'is', have: 'has', do: 'does' }

/**
 * A flavor line, written to the player ("You parked cars for the high
 * rollers."), retold about them for everyone ("tyton parked cars for the high
 * rollers."): the first "you" or "your" becomes their name, and the rest
 * become they, them and their. Work, slut and crime results post this way
 * (Tyton, Nov 22, 2026). `name` can be a placeholder to split on.
 */
export function retellLine(line: string, name: string): string {
  let named = false
  return line.replace(
    /\b(you're|you've|you'd|yourself|yours|your|you)\b(\s+([A-Za-z']+))?/gi,
    (_match, word: string, rest: string | undefined, next: string | undefined, at: number) => {
      const lower = word.toLowerCase()
      const starts = at === 0 || /[.!?]\s*$/.test(line.slice(0, at))
      const cap = (text: string) => (starts ? text[0]?.toUpperCase() + text.slice(1) : text)
      const tail = rest ?? ''
      const first = !named
      named = true
      if (lower === 'yourself') return cap('themselves') + tail
      if (lower === 'yours') return (first ? `${name}'s` : cap('theirs')) + tail
      if (lower === 'your') return (first ? `${name}'s` : cap('their')) + tail
      if (lower === "you're") return (first ? `${name} is` : cap("they're")) + tail
      if (lower === "you've") return (first ? `${name} has` : cap("they've")) + tail
      if (lower === "you'd") return (first ? `${name}'d` : cap("they'd")) + tail
      const after = (next ?? '').toLowerCase()
      const subject = starts || SUBJECT_NEXT.has(after) || after.endsWith('ed')
      if (first) {
        const verb = subject && next ? NAMED_VERB[after] : undefined
        return verb ? `${name}${tail.slice(0, tail.length - next!.length)}${verb}` : name + tail
      }
      return cap(subject ? 'they' : 'them') + tail
    },
  )
}

/** The stream's filters: Everything, Chat only, Games only. */
export const STREAM_FILTERS = ['all', 'chat', 'games'] as const
export type StreamFilter = (typeof STREAM_FILTERS)[number]

/** Whether a filter shows a topic. Announcements show under every filter. */
export function filterShows(filter: StreamFilter, topic: StreamTopic | null): boolean {
  if (topic === null) return false
  if (filter === 'all' || topic === 'news') return true
  return filter === 'chat' ? topic === 'chat' : topic === 'game'
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

/** GET /api/stream: the newest page of one filter, or the page before an item's id. */
export const StreamListInput = z.strictObject({
  filter: z.enum(STREAM_FILTERS).default('all'),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_PAGE_SIZE).optional(),
})
export type StreamListInput = z.infer<typeof StreamListInput>

/** GET /api/stream: oldest first, each card with its round. */
export interface StreamPage {
  filter: StreamFilter
  items: ChatMessage[]
  more: boolean
  /** On the newest page: your own cards whose rounds are still open, under any filter. */
  mine: ChatMessage[]
}

/** How many players a posted leaderboard shows. */
export const LOOKUP_TOP = 5

/**
 * POST /api/stream/lookup: posts what .bal or .lb shows for everyone to see,
 * when stream_bal_lb is public. `player` is a username or a display name;
 * without one, .bal is the asker's own.
 */
export const LookupInput = z.strictObject({
  what: z.enum(['balance', 'leaderboard']),
  player: z.string().trim().min(1).max(40).optional(),
})
export type LookupInput = z.infer<typeof LookupInput>

/** True when `body` mentions @username, in any case. */
export function mentions(body: string, username: string): boolean {
  const escaped = username.replace(/[^A-Za-z0-9_]/g, '')
  if (!escaped) return false
  return new RegExp(`(^|[^A-Za-z0-9_])@${escaped}(?![A-Za-z0-9_])`, 'i').test(body)
}
