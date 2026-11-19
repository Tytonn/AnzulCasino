/**
 * The end of a season (spec: Accounts and seasons > Seasons): the final day,
 * the frozen standings, the podium and the Hall of Fame. Shared by the
 * browser and the server. The server code is in server/features/season/.
 *
 * Chips are hundredths, as plain numbers on the wire.
 */
import { z } from 'zod'

import type { Tier } from '../tiers.ts'

const HOUR_MS = 3_600_000

/** When a season's final day begins: `final_freeze_hours` before its end. */
export function finalDayStartsAt(endsAt: Date, finalFreezeHours: number): Date {
  return new Date(endsAt.getTime() - Math.max(0, finalFreezeHours) * HOUR_MS)
}

/** One player in a season's frozen standings. */
export interface SeasonPlace {
  /** 1 is first. Every place is different: a tie on net worth goes to who got there first. */
  rank: number
  userId: string
  username: string
  displayName: string
  avatar: string
  avatarColor: string
  tier: Tier
  /** Wallet plus vault at the end. Hundredths. */
  netWorth: number
}

/** A finished season with its frozen standings, best first. */
export interface SeasonRecord {
  id: number
  name: string
  startsAt: string
  endsAt: string
  /** When the standings were frozen. */
  frozenAt: string
  places: SeasonPlace[]
}

/** GET /api/economy/hall-of-fame */
export interface HallOfFame {
  /** Every finished season, newest first. */
  seasons: SeasonRecord[]
  /**
   * A season that has ended but whose standings are not frozen yet, because
   * a round that was open at the end is still being played out.
   */
  pending: { id: number; name: string; endsAt: string } | null
}

export const HallOfFameInput = z.strictObject({})
export type HallOfFameInput = z.infer<typeof HallOfFameInput>

/** Medals for the podium, by place. */
export const MEDALS = ['🥇', '🥈', '🥉'] as const

export function medal(rank: number): string | null {
  return MEDALS[rank - 1] ?? null
}
