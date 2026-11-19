/**
 * The state every page shares, fetched once and kept fresh by live events
 * (the shell wires them in src/shell/LiveSync.tsx). Nothing here polls: the
 * database sleeps unless someone does something (CLAUDE.md: Keep the
 * database asleep).
 *
 *   const me = useMe()
 *   const wallet = useWallet()          // balance and vault in hundredths, or null
 *   const alice = usePlayer(userId)     // name, avatar and tier, for <PlayerName>
 */
import { type QueryClient, useQuery } from '@tanstack/react-query'

import type { Me } from '../../shared/accounts.ts'
import type { ConfigValues } from '../../shared/config.ts'
import type { PlayerSummary } from '../../shared/players.ts'
import type { LeaderboardView, SeasonState } from '../../shared/seasons.ts'
import { type TickerItem, tickerKey } from '../../shared/ticker.ts'
import type { Wire } from '../../shared/wire.ts'
import { isNewer } from '../live/versions.ts'
import { api, ApiError } from './api.ts'

export const queryKeys = {
  me: ['me'] as const,
  season: ['season'] as const,
  leaderboard: ['leaderboard'] as const,
  players: ['players'] as const,
  ticker: ['ticker'] as const,
  chat: ['chat'] as const,
  config: ['config'] as const,
}

/** The signed-in player, or null when signed out. */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async (): Promise<Me | null> => {
      try {
        return (await api.get<{ user: Me }>('/api/me')).user
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    staleTime: Infinity,
  })
}

/** The signed-in player. Only below the shell's sign-in check. */
export function useMe(): Me {
  const { data } = useSession()
  if (!data) throw new Error('useMe() needs a signed-in player.')
  return data
}

export function useSeason() {
  return useQuery({
    queryKey: queryKeys.season,
    queryFn: () => api.get<SeasonState>('/api/season'),
  })
}

/** The player's chips this season, or null outside a season. Hundredths. */
export function useWallet(): SeasonState['wallet'] {
  return useSeason().data?.wallet ?? null
}

export function useLeaderboard() {
  return useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: () => api.get<LeaderboardView>('/api/leaderboard'),
  })
}

export function usePlayers() {
  return useQuery({
    queryKey: queryKeys.players,
    queryFn: async () => (await api.get<{ players: PlayerSummary[] }>('/api/players')).players,
  })
}

/** One player by id, for <PlayerName> and <Avatar>. Undefined until loaded or if unknown. */
export function usePlayer(userId: string | null | undefined): PlayerSummary | undefined {
  const { data } = usePlayers()
  if (!userId || !data) return undefined
  return data.find((p) => p.id === userId)
}

/** The ticker's rounds and steal attempts, newest first. */
export function useTicker() {
  return useQuery({
    queryKey: queryKeys.ticker,
    queryFn: async () => (await api.get<{ items: TickerItem[] }>('/api/ticker')).items,
  })
}

/** Every tunable value (shared/config.ts), chip amounts in hundredths. */
export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: async () => (await api.get<{ config: Wire<ConfigValues> }>('/api/config')).config,
    staleTime: 10 * 60_000,
  })
}

/** The player's chips as an API response or a `wallet.updated` event gives them. */
export interface WalletNews {
  seasonId: number
  balance: number
  vault: number
  /** The latest ledger id: older news than the top bar shows is dropped. */
  version: number
}

/** Moves the top bar to the player's new chips, unless it already shows newer ones. */
export function applyWallet(queryClient: QueryClient, wallet: WalletNews): void {
  queryClient.setQueryData<SeasonState>(queryKeys.season, (old) => {
    if (!old?.wallet || old.current?.id !== wallet.seasonId) return old
    if (!isNewer(wallet.version, old.wallet.version)) return old
    return {
      ...old,
      wallet: {
        ...old.wallet,
        balance: wallet.balance,
        vault: wallet.vault,
        version: wallet.version,
      },
    }
  })
}

/** Items kept in the ticker. */
export const TICKER_KEEP = 40

/** Adds a settled round or a steal attempt to the front of the ticker, once. */
export function addTickerItem(queryClient: QueryClient, item: TickerItem): void {
  queryClient.setQueryData<TickerItem[]>(queryKeys.ticker, (old) => {
    if (!old) return old
    const key = tickerKey(item)
    if (old.some((i) => tickerKey(i) === key)) return old
    return [item, ...old].slice(0, TICKER_KEEP)
  })
}
