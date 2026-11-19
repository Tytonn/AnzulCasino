/**
 * Who is online, from the presence channel. Each browser connection is one
 * member; a player with two tabs open is one player here. Presence data comes
 * from other browsers, so it is checked before anyone sees it.
 */
import { PRESENCE_STATUSES, type PresenceData, type PresenceStatus } from '../../shared/events.ts'
import type { PresenceMember } from './transport.ts'

export interface OnlinePlayer {
  userId: string
  /** The room their most recently active tab is in, such as "coinflip". */
  room: string | null
  /** The busiest of their tabs: playing, then active, then away. */
  status: PresenceStatus
  /** Epoch milliseconds of their latest change. */
  updatedAt: number
}

const ROOM_PATTERN = /^[a-z0-9-]{1,40}$/
const STATUS_ORDER: Record<PresenceStatus, number> = { away: 0, active: 1, playing: 2 }

/** A member's data, or a safe default when a browser sent something odd. */
export function readPresence(data: unknown): PresenceData {
  const value = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const room = typeof value.room === 'string' && ROOM_PATTERN.test(value.room) ? value.room : null
  const status = PRESENCE_STATUSES.includes(value.status as PresenceStatus)
    ? (value.status as PresenceStatus)
    : 'active'
  return { room, status }
}

/** One entry per player, sorted by user id so the result is stable. */
export function onlinePlayers(members: Iterable<PresenceMember>): OnlinePlayer[] {
  const byPlayer = new Map<string, OnlinePlayer>()
  for (const member of members) {
    const data = readPresence(member.data)
    const known = byPlayer.get(member.clientId)
    if (!known) {
      byPlayer.set(member.clientId, {
        userId: member.clientId,
        room: data.room,
        status: data.status,
        updatedAt: member.timestamp,
      })
      continue
    }
    if (STATUS_ORDER[data.status] > STATUS_ORDER[known.status]) known.status = data.status
    if (member.timestamp >= known.updatedAt) {
      known.room = data.room
      known.updatedAt = member.timestamp
    }
  }
  return [...byPlayer.values()].sort((a, b) => (a.userId < b.userId ? -1 : 1))
}

/** The same players in the same state, so a list can skip a redraw. */
export function samePlayers(a: readonly OnlinePlayer[], b: readonly OnlinePlayer[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]
      return q && p.userId === q.userId && p.room === q.room && p.status === q.status
    })
  )
}
