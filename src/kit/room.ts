/**
 * A room's live state (spec: The room model): who is sitting in it, and each
 * player's latest round, kept current by the room's events. Every game's
 * room starts with it:
 *
 *   const room = useRoom<CoinflipDetail>('coinflip', { revealMs: 900 })
 *   room.seats   // you first, then everyone else in the room, for <Seat>
 *   room.mine    // your latest round: open (resume it) or just settled
 *
 * The shell's room page already shares that you are in the room. The room's
 * state comes from GET /api/<game>/room, then from the `room:<game>`
 * events; whichever is newer wins, by the round's version.
 *
 * A result shows on a seat only when the game has revealed it: yours when
 * your reveal ends (see play.ts), and another player's `revealMs` after it
 * settled, so their seat spins before it lands, as yours does.
 */
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { PresenceStatus } from '../../shared/events.ts'
import { roomChannel } from '../../shared/events.ts'
import type { PlayerSummary } from '../../shared/players.ts'
import { type RoomState, type RoundView, roundVersion } from '../../shared/rounds.ts'
import { useLiveEvent, useOnlinePlayers, usePlaying, useResync } from '../live/index.ts'
import { api } from './api.ts'
import { useMe, usePlayers } from './queries.ts'
import { afterReveal } from './reveal.ts'

export const roomKey = (game: string) => ['room', game] as const

/** The room with one round put in, if it is newer than the one that player has there. */
export function upsertRound<D>(
  state: RoomState<D> | undefined,
  round: RoundView<D>,
): RoomState<D> | undefined {
  if (!state) return state
  const index = state.rounds.findIndex((r) => r.userId === round.userId)
  if (index === -1) return { rounds: [...state.rounds, round] }
  const known = state.rounds[index] as RoundView<D>
  if (roundVersion(round) <= roundVersion(known)) return state
  const rounds = [...state.rounds]
  rounds[index] = round
  return { rounds }
}

/** Puts a round into its room's cache, if it is newer than what is there. */
export function applyRound<D>(queryClient: QueryClient, round: RoundView<D>): void {
  queryClient.setQueryData<RoomState<D>>(roomKey(round.game), (old) => upsertRound(old, round))
}

export interface RoomSeat<D = unknown> {
  /** The room's game. */
  game: string
  userId: string
  /** Name, avatar and tier. Undefined until the player list has loaded. */
  player: PlayerSummary | undefined
  /** Here, in a hand, or away. Undefined for you until presence catches up. */
  status: PresenceStatus | undefined
  /** Their latest round in this room: open, or settled in the last few minutes. */
  round: RoundView<D> | null
  me: boolean
}

export interface Room<D = unknown> {
  /** You first, then everyone else in the room, by name. */
  seats: RoomSeat<D>[]
  /** Your latest round here: open, or the last one if it just settled. */
  mine: RoundView<D> | null
  /** Your open round, to resume after a refresh. */
  open: RoundView<D> | null
  loading: boolean
  failed: boolean
  /** Loads the room again after it failed. */
  retry: () => void
}

export interface RoomOptions {
  /**
   * How long another player's result takes to show on their seat: the
   * length of the game's reveal animation (a coin in the air), so their seat
   * spins before it lands, as yours does.
   */
  revealMs?: number
}

export function useRoom<D = unknown>(game: string, options: RoomOptions = {}): Room<D> {
  const me = useMe()
  const queryClient = useQueryClient()
  const revealMs = options.revealMs ?? 0
  const query = useQuery({
    queryKey: roomKey(game),
    queryFn: () => api.get<RoomState<D>>(`/api/${game}/room`),
  })

  // Results waiting for their reveal; dropped if the room closes first.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const channel = roomChannel(game)
  useLiveEvent(channel, 'round.started', (round) => applyRound(queryClient, round as RoundView<D>))
  useLiveEvent(channel, 'round.action', (round) => applyRound(queryClient, round as RoundView<D>))
  useLiveEvent(channel, 'round.settled', (round) => {
    // Your own result waits for your reveal, like the rest of its news.
    if (round.userId === me.id) {
      afterReveal(() => applyRound(queryClient, round as RoundView<D>))
      return
    }
    if (revealMs <= 0) {
      applyRound(queryClient, round as RoundView<D>)
      return
    }
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      applyRound(queryClient, round as RoundView<D>)
    }, revealMs)
    timers.current.add(timer)
  })
  useResync(() => {
    void queryClient.invalidateQueries({ queryKey: roomKey(game) }, { cancelRefetch: false })
  })

  const online = useOnlinePlayers()
  const { data: players } = usePlayers()
  const rounds = query.data?.rounds

  const seats = useMemo(() => {
    const roundOf = (userId: string) => rounds?.find((r) => r.userId === userId) ?? null
    const playerOf = (userId: string) => players?.find((p) => p.id === userId)
    const mine: RoomSeat<D> = {
      game,
      userId: me.id,
      player: playerOf(me.id),
      status: online.find((p) => p.userId === me.id)?.status,
      round: roundOf(me.id),
      me: true,
    }
    const others = online
      .filter((p) => p.room === game && p.userId !== me.id)
      .map((p): RoomSeat<D> => ({
        game,
        userId: p.userId,
        player: playerOf(p.userId),
        status: p.status,
        round: roundOf(p.userId),
        me: false,
      }))
      .sort((a, b) => (a.player?.displayName ?? '').localeCompare(b.player?.displayName ?? ''))
    return [mine, ...others]
  }, [online, players, rounds, me.id, game])

  const mine = seats[0]?.round ?? null
  const open = mine?.status === 'open' ? mine : null
  // Others see you "in a hand" while a round is open.
  usePlaying(open !== null)

  const { refetch } = query
  const retry = useCallback(() => void refetch(), [refetch])

  return { seats, mine, open, loading: query.isPending, failed: query.isError, retry }
}
