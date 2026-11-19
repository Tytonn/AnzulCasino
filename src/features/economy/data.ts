/**
 * The player's economy in the browser: one query for GET /api/economy/state,
 * kept current by the answers to their own presses and by live events
 * (Overlay.tsx). Nothing here polls: the server moves the season on when a
 * browser asks, and live news covers the rest.
 */
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'

import { formatChips } from '../../../shared/chips.ts'
import {
  accruedIncomeShown,
  type DropClaimed,
  type DropView,
  type EconomyState,
  type EconomyStateResponse,
  type IncomeCommand,
  incomeFullInMs,
} from '../../../shared/features/economy.ts'
import { api } from '../../kit/api.ts'
import { useNow } from '../../kit/clock.ts'
import { useConfig } from '../../kit/queries.ts'

export const economyKey = ['economy', 'state'] as const

/** The player's economy this season, or null outside one. */
export function useEconomy() {
  const queryClient = useQueryClient()
  return useQuery({ queryKey: economyKey, queryFn: () => fetchEconomy(queryClient) })
}

/**
 * Fetches the state, but keeps the cached one when that is newer. A fetch
 * can start before a press and land after the press's answer (a resync on
 * connect, news from another tab), and its older state would otherwise show
 * the button as ready again.
 */
export async function fetchEconomy(queryClient: QueryClient): Promise<EconomyState | null> {
  const { state } = await api.get<EconomyStateResponse>('/api/economy/state')
  return newer(queryClient.getQueryData<EconomyState | null>(economyKey), state)
}

/** Puts a state from an answer into the cache, unless the cache already holds a newer one. */
export function putEconomy(queryClient: QueryClient, state: EconomyState): void {
  queryClient.setQueryData<EconomyState | null>(economyKey, (old) => newer(old, state))
}

/** The cached state if it is newer than the one that came in, or else the one that came in. */
function newer(
  cached: EconomyState | null | undefined,
  state: EconomyState | null,
): EconomyState | null {
  if (cached && state && cached.seasonId === state.seasonId && cached.version > state.version) {
    return cached
  }
  return state
}

/** Changes the cached state in place, if there is one. */
export function editEconomy(
  queryClient: QueryClient,
  edit: (state: EconomyState) => EconomyState,
): void {
  queryClient.setQueryData<EconomyState | null>(economyKey, (old) => (old ? edit(old) : old))
}

/** Marks a button as cooling down until `readyAt`, from a refusal's `readyAt`. */
export function coolDown(queryClient: QueryClient, command: IncomeCommand, readyAt: string) {
  editEconomy(queryClient, (s) => ({ ...s, cooldowns: { ...s.cooldowns, [command]: readyAt } }))
}

// ---------------------------------------------------------------- chat drops

/** A drop that just landed in chat, before the next fetch knows it. Older drops close. */
export function addDrop(queryClient: QueryClient, drop: DropView): void {
  editEconomy(queryClient, (s) => {
    if (s.drops.some((d) => d.id === drop.id)) return s
    const older = s.drops.map((d) => (d.open ? { ...d, open: false } : d))
    return { ...s, drops: [drop, ...older] }
  })
}

/** Someone grabbed a share: shows it on the drop, for everyone, as it happens. */
export function addDropClaim(queryClient: QueryClient, claim: DropClaimed): void {
  editEconomy(queryClient, (s) => ({
    ...s,
    drops: s.drops.map((d) => {
      if (d.id !== claim.dropId) return d
      const claims = d.claims.some((c) => c.userId === claim.userId)
        ? d.claims
        : [...d.claims, { userId: claim.userId, amount: claim.amount }]
      return { ...d, claims, open: d.open && claims.length < d.winners }
    }),
  }))
}

// ---------------------------------------------------------------- the clock

/** Milliseconds until `iso`, or 0 once it has passed. */
export function msUntil(iso: string | null | undefined, now: number): number {
  if (!iso) return 0
  return Math.max(0, Date.parse(iso) - now)
}

/** A countdown that fits a phone's top-bar button: "4:59", "1h59". */
export function shortWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** A countdown in a sentence: "4:59", "1h 59m", "2d 4h". Rounds up, so it never says 0:00 early. */
export function longWait(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** "just now", "4m ago", "2h ago", "3d ago". */
export function ago(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// ---------------------------------------------------------------- income

export interface IncomeNow {
  /** Hundredths of income waiting now. */
  income: number
  /** The streak bonus waiting today, or 0 once paid. */
  bonus: number
  /** What a Collect pays now. */
  total: number
  /** 0 to 1: how full the income is toward its cap. */
  fill: number
  /** Milliseconds until income stops growing. */
  fullInMs: number
  /** Hundredths a day at the player's rank. */
  perDay: number
}

/** Income waiting now, ticking with the server's clock. Display only: the server counts. */
export function incomeNow(state: EconomyState, now: number): IncomeNow {
  const elapsed = Math.max(0, now - Date.parse(state.income.since))
  const cap = state.income.capHours
  const income = accruedIncomeShown(state.income.perDay, elapsed, cap)
  const bonus = state.streak.claimedToday ? 0 : state.streak.bonus
  const capMs = cap * 3_600_000
  return {
    income,
    bonus,
    total: income + bonus,
    fill: capMs > 0 ? Math.min(1, elapsed / capMs) : 1,
    fullInMs: incomeFullInMs(elapsed, cap),
    perDay: state.income.perDay,
  }
}

/** The economy's income, ticking every second. */
export function useIncome(state: EconomyState | null | undefined): IncomeNow | null {
  const now = useNow().getTime()
  return state ? incomeNow(state, now) : null
}

/** The hustle button's name, as the admin set it ("Slut" to start). */
export function useHustleName(): string {
  const name = useConfig().data?.hustle_name
  return typeof name === 'string' && name.trim() ? name.trim() : 'Slut'
}

/** "15 a day", "1,000 a day". */
export function perDayText(perDay: number): string {
  return `${formatChips(perDay)} a day`
}
