/**
 * The season countdown in the top bar (spec: Top bar; Final day: "a banner
 * and countdown make this obvious all day"). Display only: the server
 * decides when betting ends, by its own clock.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { formatCountdown, useNow } from '../../kit/clock.ts'
import { queryKeys, useSeason } from '../../kit/queries.ts'

export function SeasonClock({ compact = false }: { compact?: boolean }) {
  const { data } = useSeason()
  const now = useNow().getTime()
  const queryClient = useQueryClient()

  const current = data?.current
  const running = current && (current.phase === 'open' || current.phase === 'final_day')
  const target = running
    ? Date.parse(current.endsAt)
    : data?.next
      ? Date.parse(data.next.startsAt)
      : null
  const left = target === null ? null : target - now
  const due = left !== null && left <= 0

  // At zero the season starts or ends on the server's next request: ask.
  useEffect(() => {
    if (!due) return
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.season })
      void queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard })
    }, 1_500)
    return () => clearTimeout(timer)
  }, [due, queryClient])

  if (!data) return <span className="skeleton h-4 w-20" />

  let label: string
  let value: string
  let tone = 'text-text'
  if (running && left !== null) {
    const finalDay = current.phase === 'final_day' || left <= 24 * 3_600_000
    label = finalDay ? 'Final day' : current.name
    value = formatCountdown(left)
    if (finalDay) tone = 'text-gold'
  } else if (data.next && left !== null) {
    label = 'Next season'
    value = formatCountdown(left)
  } else if (current) {
    label = current.name
    value = 'Ended'
    tone = 'text-muted'
  } else {
    label = 'Season'
    value = 'Not scheduled'
    tone = 'text-muted'
  }

  if (compact) {
    return (
      <span className={`text-right text-xs leading-tight ${tone}`} title={label}>
        <span className="block text-[0.6rem] tracking-wide text-faint uppercase">
          {label.length > 12 ? 'Season' : label}
        </span>
        <span className="font-semibold tabular-nums">{value}</span>
      </span>
    )
  }
  return (
    <span className="flex flex-col items-end leading-tight" title={`${label}: ${value}`}>
      <span className="max-w-36 truncate text-[0.65rem] tracking-[0.08em] text-faint uppercase">
        {label}
      </span>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>
        {running ? `${value} left` : value}
      </span>
    </span>
  )
}
