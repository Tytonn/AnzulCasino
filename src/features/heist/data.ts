/**
 * Heist's data in the browser: the caller's heist state and the steals log,
 * fetched once and kept current by live events (HeistSync in Overlay.tsx).
 * Nothing polls. `useHeist()` joins them with the leaderboard, the config
 * and the clock into what every heist screen draws.
 */
import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { create } from 'zustand'

import { configDefaults } from '../../../shared/config.ts'
import type { HeistState, StealView } from '../../../shared/features/heist.ts'
import { seasonPhase, type SeasonPhase, type StandingView } from '../../../shared/seasons.ts'
import { api } from '../../kit/api.ts'
import { useNow } from '../../kit/clock.ts'
import { useConfig, useLeaderboard, useMe, useSeason, useWallet } from '../../kit/queries.ts'
import { useUi } from '../../shell/ui.ts'
import { heistAsOf, heistConfig, type HeistConfig, type TargetRow, targetRows } from './derive.ts'

export const heistKeys = {
  all: ['heist'] as const,
  state: ['heist', 'state'] as const,
  steals: ['heist', 'steals'] as const,
}

/** Steals kept in the log. */
export const LOG_KEEP = 50

export function useHeistState() {
  return useQuery({
    queryKey: heistKeys.state,
    queryFn: () => api.get<HeistState>('/api/heist/state'),
  })
}

export function useSteals(enabled = true) {
  return useQuery({
    queryKey: heistKeys.steals,
    queryFn: async () =>
      (await api.get<{ steals: StealView[] }>(`/api/heist/steals?limit=${LOG_KEEP}`)).steals,
    enabled,
  })
}

/** Puts a new attempt at the top of the log, once. */
export function addToLog(queryClient: QueryClient, steal: StealView): void {
  queryClient.setQueryData<StealView[]>(heistKeys.steals, (old) => {
    if (!old || old.some((s) => s.id === steal.id)) return old
    return [steal, ...old].slice(0, LOG_KEEP)
  })
}

/** Changes the cached heist state, if there is one. */
export function patchHeist(queryClient: QueryClient, change: (state: HeistState) => HeistState) {
  queryClient.setQueryData<HeistState>(heistKeys.state, (old) => (old ? change(old) : old))
}

/** Steal ids this tab has already folded into its state, so none counts twice. */
export const appliedSteals = new Set<number>()

// ---------------------------------------------------------------- everything a screen needs

export interface Heist {
  /** The heist state, the leaderboard and the config have all loaded. */
  ready: boolean
  /** The state as of now, or null while loading or outside a season. */
  state: (HeistState & { rolled: boolean }) | null
  cfg: HeistConfig
  phase: SeasonPhase | null
  /** Server time, ticking every second. */
  now: number
  meId: string
  myStanding: StandingView | undefined
  /** Chips, from the top bar's wallet. */
  balance: number
  vault: number
  attemptsLeft: number
  /** Steals, shields and vault moves are open (not the final day, not between seasons). */
  open: boolean
  /** The extra attempt is still for sale today. */
  canBuyExtra: boolean
  /** Milliseconds of your own immunity left, 0 when none. */
  immuneLeft: number
  targets: TargetRow[]
  target(userId: string): TargetRow | undefined
}

export function useHeist(): Heist {
  const me = useMe()
  const now = useNow().getTime()
  const { data: rawState, isSuccess: stateLoaded } = useHeistState()
  const { data: board, isSuccess: boardLoaded } = useLeaderboard()
  const { data: wireConfig } = useConfig()
  const season = useSeason().data?.current ?? null
  const wallet = useWallet()

  const cfg = useMemo(() => heistConfig(wireConfig ?? configDefaults()), [wireConfig])
  const standings = useMemo(() => board?.standings ?? [], [board])
  const myStanding = standings.find((s) => s.userId === me.id)
  const phase = season
    ? seasonPhase(
        { startsAt: new Date(season.startsAt), endsAt: new Date(season.endsAt) },
        new Date(now),
        cfg.final_freeze_hours,
      )
    : null

  const state = useMemo(() => {
    if (!rawState || rawState.seasonId === null) return null
    const worth = new Map(standings.map((s) => [s.userId, s.netWorth]))
    const mine = myStanding?.netWorth ?? (wallet ? wallet.balance + wallet.vault : 0)
    return heistAsOf(rawState, now, cfg, (id) => worth.get(id), mine)
  }, [rawState, standings, myStanding, wallet, now, cfg])

  const targets = useMemo(
    () =>
      state ? targetRows({ standings, meId: me.id, state, phase, now, cfg }) : ([] as TargetRow[]),
    [state, standings, me.id, phase, now, cfg],
  )

  const open = phase === 'open' && wallet !== null
  const attemptsLeft = state ? Math.max(0, state.me.attemptsAllowed - state.me.attemptsUsed) : 0
  const immuneUntil = state?.me.immuneUntil ? Date.parse(state.me.immuneUntil) : 0

  return {
    ready: stateLoaded && boardLoaded,
    state,
    cfg,
    phase,
    now,
    meId: me.id,
    myStanding,
    balance: wallet?.balance ?? 0,
    vault: wallet?.vault ?? 0,
    attemptsLeft,
    open,
    canBuyExtra: open && state !== null && !state.me.extraBought,
    immuneLeft: Math.max(0, immuneUntil - now),
    targets,
    target: (userId) => targets.find((t) => t.standing.userId === userId),
  }
}

// ---------------------------------------------------------------- what is open

export type HeistTab = 'rob' | 'defend' | 'log'

interface HeistUi {
  /** The heist panel and its tab, or null when closed. */
  panel: HeistTab | null
  /** The player the steal dialog is aimed at. */
  stealTarget: string | null
  /** The steal dialog was opened from the panel, so "Rob someone else" goes back there. */
  fromPanel: boolean
  /** The vault is being cracked: closing the dialog skips to the ending instead. */
  cracking: boolean
  /** Goes up by one each time the player asks to skip the suspense. */
  skips: number
  openPanel(tab?: HeistTab): void
  closePanel(): void
  /** Opens the steal dialog. Anything else open over the page closes first. */
  rob(userId: string): void
  closeSteal(): void
  setCracking(cracking: boolean): void
  /** Escape, a click on the vault or Enter: skip the suspense, or close the dialog. */
  dismissSteal(): void
}

export const useHeistUi = create<HeistUi>((set, get) => ({
  panel: null,
  stealTarget: null,
  fromPanel: false,
  cracking: false,
  skips: 0,
  openPanel: (tab = 'rob') => {
    useUi.setState({ profile: null, sheet: null, drawer: false })
    set({ panel: tab })
  },
  closePanel: () => set({ panel: null }),
  rob: (userId) => {
    // Two panels over each other would both close on one Escape.
    useUi.setState({ profile: null, sheet: null, drawer: false })
    set({ stealTarget: userId, fromPanel: get().panel !== null, panel: null })
  },
  closeSteal: () => set({ stealTarget: null, cracking: false }),
  setCracking: (cracking) => set({ cracking }),
  dismissSteal: () => {
    if (get().cracking) set((s) => ({ skips: s.skips + 1 }))
    else set({ stealTarget: null })
  },
}))
