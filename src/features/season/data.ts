/**
 * The season's end in the browser: the Hall of Fame (GET
 * /api/economy/hall-of-fame, which also moves a finished season on to its
 * frozen standings), and where the season stands by the clock.
 */
import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'

import type { HallOfFame, SeasonRecord } from '../../../shared/features/season.ts'
import { type SeasonPhase, seasonPhase, type SeasonView } from '../../../shared/seasons.ts'
import { api } from '../../kit/api.ts'
import { useNow } from '../../kit/clock.ts'
import { useConfig, useSeason } from '../../kit/queries.ts'

export const hallOfFameKey = ['season', 'hall-of-fame'] as const

export function useHallOfFame(enabled = true) {
  return useQuery({
    queryKey: hallOfFameKey,
    queryFn: () => api.get<HallOfFame>('/api/economy/hall-of-fame'),
    enabled,
  })
}

export interface SeasonNow {
  /** The season running now, or else the last one that ran. */
  current: SeasonView | null
  /** The next season that has not started. */
  next: SeasonView | null
  /** Where `current` is by the server's clock now, not when it was fetched. */
  phase: SeasonPhase | null
  /** Server time, epoch milliseconds, ticking every second. */
  now: number
  /** Hours the final day lasts. */
  finalHours: number
}

/** The season and its phase, kept exact by the clock between fetches. */
export function useSeasonNow(): SeasonNow | null {
  const { data } = useSeason()
  const finalHours = useConfig().data?.final_freeze_hours ?? 24
  const now = useNow().getTime()
  if (!data) return null
  const current = data.current
  const phase = current
    ? seasonPhase(
        { startsAt: new Date(current.startsAt), endsAt: new Date(current.endsAt) },
        new Date(now),
        finalHours,
      )
    : null
  return { current, next: data.next, phase, now, finalHours }
}

/** A finished season's record, if its standings are frozen. */
export function recordFor(fame: HallOfFame | undefined, seasonId: number | undefined) {
  if (!fame || seasonId === undefined) return null
  return fame.seasons.find((s: SeasonRecord) => s.id === seasonId) ?? null
}

/** "23:59:58": hours, minutes and seconds, for the final day's countdown. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`
}

const DAY: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
const DAY_YEAR: Intl.DateTimeFormatOptions = { ...DAY, year: 'numeric' }

/** "Nov 1 – Nov 30, 2026", by the last moment the season ran. */
export function seasonDates(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt)
  const end = new Date(Date.parse(endsAt) - 1)
  if (start.toDateString() === end.toDateString()) return end.toLocaleDateString('en-US', DAY_YEAR)
  const sameYear = start.getFullYear() === end.getFullYear()
  const from = start.toLocaleDateString('en-US', sameYear ? DAY : DAY_YEAR)
  return `${from} – ${end.toLocaleDateString('en-US', DAY_YEAR)}`
}

/** "Mon, Dec 1 at 6:00 PM", in the player's own time zone. */
export function startText(at: string): string {
  const when = new Date(at)
  const day = when.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${day} at ${time}`
}

/** "1st", "2nd", "3rd", "11th". */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

// ---------------------------------------------------------------- the podium screen

/** Which season's podium is up, if any. */
export const usePodium = create<{ seasonId: number | null }>(() => ({ seasonId: null }))

export function openPodium(seasonId: number): void {
  usePodium.setState({ seasonId })
}

export function closePodium(): void {
  usePodium.setState({ seasonId: null })
}

/**
 * The podium opens by itself once per season and player, remembered in this
 * browser. Storage can be off (a private window): then it opens once per visit.
 */
const seenKey = (userId: string, seasonId: number) => `anzul.podium.${userId}.${seasonId}`
const seenThisVisit = new Set<string>()

export function podiumSeen(userId: string, seasonId: number): boolean {
  const key = seenKey(userId, seasonId)
  if (seenThisVisit.has(key)) return true
  try {
    return window.localStorage.getItem(key) !== null
  } catch {
    return false
  }
}

export function markPodiumSeen(userId: string, seasonId: number): void {
  const key = seenKey(userId, seasonId)
  seenThisVisit.add(key)
  try {
    window.localStorage.setItem(key, new Date().toISOString())
  } catch {
    // Remembered for this visit only.
  }
}
