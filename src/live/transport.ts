/**
 * What the live client needs from a transport: Ably on Netlify, the local
 * relay (scripts/dev/live-relay.ts) in development and browser tests. Game
 * code never sees this layer; it uses the client and the hooks.
 *
 * Channel names here are full names, with the deploy prefix.
 */
import type { LiveEnvelope, LiveTokenResponse } from '../../shared/events.ts'

export type PresenceAction = 'enter' | 'update' | 'leave'

/** One browser connection in presence. A player with two tabs open has two. */
export interface PresenceMember {
  /** The player's user id, set by the server-signed token, so it cannot be faked. */
  clientId: string
  connectionId: string
  /** What that browser shared. Untrusted: check it before showing it. */
  data: unknown
  /** Epoch milliseconds of the member's last change. */
  timestamp: number
}

export type TransportState = 'connecting' | 'connected' | 'disconnected' | 'failed'

export interface TransportEvents {
  message(channel: string, name: string, envelope: LiveEnvelope): void
  presence(channel: string, action: PresenceAction, member: PresenceMember): void
  state(state: TransportState): void
  /** Events may have been missed (a new connection with no history, or a lost resume). */
  discontinuity(): void
}

export interface Transport {
  /** Starts listening. With `presence`, also hears who enters and leaves. */
  attach(channel: string, options?: { presence?: boolean }): void
  detach(channel: string): void
  /** Enters presence, or updates it if this connection is already in. */
  enterPresence(channel: string, data: unknown): Promise<void>
  leavePresence(channel: string): Promise<void>
  presenceMembers(channel: string): Promise<PresenceMember[]>
  close(): void
}

/** Asks the server for a new token (GET /api/live/token). */
export type RenewToken = () => Promise<LiveTokenResponse>

export type LocalToken = Extract<LiveTokenResponse, { transport: 'local' }>
export type AblyToken = Extract<LiveTokenResponse, { transport: 'ably' }>
