/**
 * Keeps the shared caches current from live events (spec: Live events >
 * Recovery): the wallet, the leaderboard, the ticker, chat and the season.
 * Whenever events may have been missed, it fetches again; events older than
 * what was fetched are dropped by their versions.
 */
import { useQueryClient } from '@tanstack/react-query'

import type { Me } from '../../shared/accounts.ts'
import type { ChatPage } from '../../shared/chat.ts'
import { userChannel } from '../../shared/events.ts'
import type { PlayerSummary } from '../../shared/players.ts'
import type { LeaderboardView, SeasonState } from '../../shared/seasons.ts'
import { isTier } from '../../shared/tiers.ts'
import { addTickerRound, queryKeys, useConfig } from '../kit/queries.ts'
import { toast } from '../kit/toast.tsx'
import { isNewer, useAwayAfter, useLiveEvent, useResync } from '../live/index.ts'
import { addMessage, removeMessage } from './chat-cache.ts'
import { applyStanding } from './standings.ts'

const SHARED = [
  queryKeys.season,
  queryKeys.leaderboard,
  queryKeys.players,
  queryKeys.ticker,
  queryKeys.chat,
]

export function LiveSync({ me }: { me: Me }) {
  const queryClient = useQueryClient()
  const awayMinutes = useConfig().data?.away_minutes ?? 5

  useResync(() => {
    for (const queryKey of SHARED) {
      // A fetch already on its way is as good as a new one.
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false })
    }
  })

  useLiveEvent(userChannel(me.id), 'wallet.updated', (wallet, { version }) => {
    queryClient.setQueryData<SeasonState>(queryKeys.season, (old) => {
      if (!old?.wallet || old.current?.id !== wallet.seasonId) return old
      if (!isNewer(version, old.wallet.version)) return old
      return {
        ...old,
        wallet: { ...old.wallet, balance: wallet.balance, vault: wallet.vault, version },
      }
    })
  })

  useLiveEvent(userChannel(me.id), 'notification', ({ text, tone }) => {
    if (tone === 'bad') toast.error(text)
    else if (tone === 'good') toast.good(text)
    else toast.info(text)
  })

  useLiveEvent('feed', 'standing.changed', (change, { version }) => {
    const board = queryClient.getQueryData<LeaderboardView>(queryKeys.leaderboard)
    if (board) {
      const next = applyStanding(board, change, version)
      if (next === 'refetch')
        void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
      else if (next !== board) queryClient.setQueryData(queryKeys.leaderboard, next)
    }
    if (isTier(change.tier)) {
      const tier = change.tier
      queryClient.setQueryData<PlayerSummary[]>(queryKeys.players, (old) =>
        old?.map((p) => (p.id === change.userId && p.tier !== tier ? { ...p, tier } : p)),
      )
    }
  })

  useLiveEvent('feed', 'round.settled', (round) => addTickerRound(queryClient, round))

  useLiveEvent('feed', 'season.state', () => {
    for (const queryKey of SHARED) void queryClient.invalidateQueries({ queryKey })
  })

  useLiveEvent('chat', 'chat.message', (message) => {
    queryClient.setQueryData<ChatPage>(queryKeys.chat, (old) => addMessage(old, message))
    const players = queryClient.getQueryData<PlayerSummary[]>(queryKeys.players)
    if (message.userId && players && !players.some((p) => p.id === message.userId)) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.players })
    }
  })

  useLiveEvent('chat', 'chat.deleted', ({ id }) => {
    queryClient.setQueryData<ChatPage>(queryKeys.chat, (old) => removeMessage(old, id))
  })

  useAwayAfter(awayMinutes)
  return null
}
