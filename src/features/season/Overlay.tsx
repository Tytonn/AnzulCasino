/**
 * The season's part of every page (the `overlay` slot, mounted once): the
 * podium screen, and the news that brings it once the season ends.
 *
 * At the end time the Hall of Fame's request also freezes the standings (the
 * server moves seasons on when asked, not on a timer). It answers "pending"
 * while a round that was open at the end is still being played out. Then:
 *
 * - `season.state`: the standings froze, or the season moved on. Fetch again.
 * - `round.settled`: while pending, any settled round may be the last one.
 * - One timer at the end plus `round_timeout_minutes`, when the server
 *   freezes whatever is still open.
 *
 * Once the record is there, the podium opens by itself, once per season.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { serverNow } from '../../kit/clock.ts'
import { useConfig, useMe } from '../../kit/queries.ts'
import { useLiveEvent, useResync } from '../../live/index.ts'
import {
  hallOfFameKey,
  markPodiumSeen,
  openPodium,
  podiumSeen,
  recordFor,
  useHallOfFame,
  useSeasonNow,
} from './data.ts'
import { PodiumLayer } from './PodiumScreen.tsx'

/** Rounds settling in a burst fetch once. */
const SETTLE_MS = 1_500

export function SeasonOverlay() {
  const me = useMe()
  const queryClient = useQueryClient()
  const season = useSeasonNow()
  const timeoutMinutes = useConfig().data?.round_timeout_minutes ?? 10
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const current = season?.current ?? null
  const over = season?.phase === 'over'
  const { data: fame } = useHallOfFame(over)
  const record = over ? recordFor(fame, current?.id) : null
  const waiting = over && !record

  const refetch = () => void queryClient.invalidateQueries({ queryKey: hallOfFameKey })

  useLiveEvent('feed', 'season.state', refetch)

  useResync(() => {
    if (over) refetch()
  })

  useLiveEvent('feed', 'round.settled', () => {
    if (!waiting) return
    clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(refetch, SETTLE_MS)
  })

  useEffect(() => () => clearTimeout(settleTimer.current), [])

  // By round_timeout_minutes after the end, the server freezes whatever is open.
  const endsAt = current?.endsAt
  useEffect(() => {
    if (!waiting || !endsAt) return
    const wait = Date.parse(endsAt) + timeoutMinutes * 60_000 + 3_000 - serverNow()
    if (wait <= 0 || wait > 6 * 3_600_000) return
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') refetch()
    }, wait)
    return () => clearTimeout(timer)
    // refetch reads the latest query client when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, endsAt, timeoutMinutes])

  // The podium opens by itself once per season.
  const recordId = record?.id
  useEffect(() => {
    if (recordId === undefined || podiumSeen(me.id, recordId)) return
    markPodiumSeen(me.id, recordId)
    openPodium(recordId)
  }, [recordId, me.id])

  return <PodiumLayer />
}
