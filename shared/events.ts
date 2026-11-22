/**
 * Live events (spec: Live events). The database is the truth; these are only
 * the news of it, published by the server after each commit. Browsers listen
 * and never publish. Both sides use these types.
 *
 * Every event is self-contained: an id, the server time, a version, and
 * enough data to draw it without a fetch. Chip amounts are whole chips, as
 * plain numbers.
 *
 * A lane adds its own events without editing this file, by extending the
 * map for the channel from a file of its own:
 *
 *   declare module '../../shared/events.ts' {
 *     interface UserEvents {
 *       'shield.blocked': ShieldBlockedEvent
 *     }
 *   }
 */

import type { ChatMessage } from './chat.ts'
import type { RoundView } from './rounds.ts'
import type { SeasonPhase } from './seasons.ts'
import type { StealResult } from './steals.ts'

/** Logical channel names. The live layer adds a prefix per deploy. */
export type Channel = 'presence' | 'chat' | 'feed' | `room:${string}` | `user:${string}`

export const roomChannel = (game: string) => `room:${game}` as const
export const userChannel = (userId: string) => `user:${userId}` as const

// ---------------------------------------------------------------- feed (everyone)

export interface FeedEvents {
  /** A player's chips changed. Drives the live leaderboard. Version: the wallet's latest ledger id. */
  'standing.changed': StandingChanged
  /** Every settled round from every room, for the ticker. Version: the round id. */
  'round.settled': RoundSummary
  /** A season started, entered its final day or ended: refetch the season. */
  'season.state': SeasonStateChanged
  /**
   * Every steal attempt, for the ticker, chat and the heist lane's log. The
   * heist lane publishes it. Version: the steal id.
   */
  'steal.result': StealResult
  /**
   * An admin changed a setting: browsers fetch /api/config again. A change
   * that waits for the daily reset says when it starts. Version: the change's id.
   */
  'config.changed': ConfigChangedEvent
}

export interface ConfigChangedEvent {
  key: string
  /** ISO time it takes effect. */
  effectiveAt: string
}

export interface StandingChanged {
  seasonId: number
  userId: string
  balance: number
  vault: number
  netWorth: number
  tier: string
}

export interface RoundSummary {
  seasonId: number
  roundId: number
  game: string
  userId: string
  stake: number
  payout: number
  /** Payout minus stake. */
  net: number
  /** Hundredths of a multiplier (250 is 2.50x), when the game has one. */
  multiplier: number | null
  /** One line for the ticker, such as "Heads". */
  summary: string
  bigBet: boolean
}

export interface SeasonStateChanged {
  seasonId: number
  phase: SeasonPhase
}

// ---------------------------------------------------------------- chat (everyone)

export interface ChatEvents {
  /** Version: the message id. */
  'chat.message': ChatMessageEvent
  /** An admin deleted a message. Version: the message id. */
  'chat.deleted': { id: number }
}

export type ChatMessageEvent = ChatMessage

// ---------------------------------------------------------------- room:<game> (everyone)

/**
 * Public round events. The round's `detail` is the game's own public shape,
 * never its secret. Version: `roundVersion(round)` (shared/rounds.ts).
 */
export interface RoomEvents {
  /** A player placed a bet: their seat shows the stake, and glows for a big bet. */
  'round.started': RoundView
  /** A move within a round, such as a card dealt or a tile opened. */
  'round.action': RoundView
  /** The round is over: its payout, multiplier and summary are set. */
  'round.settled': RoundView
  'seat.emote': { userId: string; emote: string }
}

// ---------------------------------------------------------------- user:<id> (that player only)

export interface UserEvents {
  /** The player's own chips changed, from this tab or anywhere else. Version: the latest ledger id. */
  'wallet.updated': WalletUpdated
  notification: { text: string; tone: 'info' | 'good' | 'bad' }
}

export interface WalletUpdated {
  seasonId: number
  balance: number
  vault: number
}

// ---------------------------------------------------------------- envelope

/** The events each channel carries. */
export type EventsOn<C extends Channel> = C extends 'feed'
  ? FeedEvents
  : C extends 'chat'
    ? ChatEvents
    : C extends `room:${string}`
      ? RoomEvents
      : C extends `user:${string}`
        ? UserEvents
        : Record<never, never>

export type EventName<C extends Channel> = Extract<keyof EventsOn<C>, string>

/** What travels in each live message. */
export interface LiveEnvelope<D = unknown> {
  /** Unique; a browser drops an event it has already seen. */
  id: string
  /** Server time when it was published, epoch milliseconds. */
  at: number
  /**
   * Grows with every change to the thing the event is about (see each
   * event). A browser drops an event whose version is not newer than the
   * state it fetched.
   */
  version: number
  data: D
}

/** Presence data each browser shares on the `presence` channel. */
export interface PresenceData {
  /** The room the player is in, such as "coinflip", or null on other pages. */
  room: string | null
  status: PresenceStatus
}

export const PRESENCE_STATUSES = ['active', 'playing', 'away'] as const
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number]

/** GET /api/live/token: how this browser connects. */
export type LiveTokenResponse =
  | {
      transport: 'ably'
      prefix: string
      clientId: string
      /** A signed Ably TokenRequest for the browser to exchange. */
      tokenRequest: unknown
    }
  | {
      transport: 'local'
      prefix: string
      clientId: string
      token: string
      /** The local relay's address. */
      url: string
    }
  | { transport: 'none' }
