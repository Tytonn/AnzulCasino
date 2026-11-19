/**
 * The season's strip above every page (the `banner` slot):
 *
 * - **The final day** (spec: Seasons: "A banner and countdown make this
 *   obvious all day"): gold, with the time left and what is switched off.
 *   A thin line along its foot runs down with the day.
 * - **Between seasons** (spec: Seasons: "the site shows results and the next
 *   start date"): who won, a button back to the podium, where the player
 *   finished and when the next season starts. While a round that was open at
 *   the end plays out, it says the standings are being settled.
 *
 * Nothing shows while a season runs, or before the first one starts (the top
 * bar's clock and the Floor say when).
 */
import { motion, useReducedMotion } from 'motion/react'

import { formatChips } from '../../../shared/chips.ts'
import type { SeasonView } from '../../../shared/seasons.ts'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown } from '../../kit/clock.ts'
import { Avatar } from '../../kit/PlayerName.tsx'
import { useMe } from '../../kit/queries.ts'
import {
  clockText,
  openPodium,
  ordinal,
  recordFor,
  type SeasonNow,
  startText,
  useHallOfFame,
  useSeasonNow,
} from './data.ts'
import { FlagIcon, HourglassIcon } from './icons.tsx'

type Running = SeasonNow & { current: SeasonView }

const MINUTE = 60_000
const HOUR = 3_600_000

// ---------------------------------------------------------------- the final day

function FinalDay({ season }: { season: Running }) {
  const reduced = useReducedMotion() ?? false
  const left = Math.max(0, Date.parse(season.current.endsAt) - season.now)
  const span = Math.max(1, season.finalHours * HOUR)
  const label = left <= MINUTE ? 'Last minute' : left <= HOUR ? 'Final hour' : 'Final day'
  return (
    <section
      aria-label="Final day"
      data-season="final-day"
      className="relative overflow-hidden border-b border-[color-mix(in_oklab,var(--final-day)_32%,var(--border))] bg-[color-mix(in_oklab,var(--final-day)_8%,var(--surface-1))]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-72 bg-linear-to-r from-[color-mix(in_oklab,var(--final-day)_14%,transparent)] to-transparent"
      />
      <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 md:px-8 md:py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--final-day)_18%,var(--surface-2))] text-(--final-day)">
            <motion.span
              className="block"
              animate={reduced ? undefined : { rotate: [0, 0, 180] }}
              transition={{ duration: 8, times: [0, 0.9, 1], repeat: Infinity, ease: 'easeInOut' }}
            >
              <HourglassIcon className="size-4.5" />
            </motion.span>
          </span>
          <p className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-xs font-bold tracking-[0.14em] text-(--final-day) uppercase">
              {label}
            </span>
            <span
              role="timer"
              className={`text-lg leading-none font-black text-text tabular-nums ${left <= MINUTE ? 'animate-pulse' : ''}`}
            >
              {clockText(left)}
            </span>
            <span className="text-xs text-muted">left</span>
          </p>
        </div>
        <p className="min-w-0 flex-1 basis-72 text-xs leading-snug text-muted md:text-[0.8rem]">
          Steals, shields, vault moves and rank purchases are off.
          <span className="hidden sm:inline"> The games stay open right to the end.</span>
        </p>
      </div>
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-0.5 bg-(--final-day) transition-[width] duration-1000 ease-linear"
        style={{ width: `${Math.min(100, (left / span) * 100)}%` }}
      />
    </section>
  )
}

// ---------------------------------------------------------------- between seasons

function NextLine({ season }: { season: Running }) {
  const next = season.next
  if (!next || Date.parse(next.startsAt) <= season.now) {
    return <>The next season is not scheduled yet.</>
  }
  return (
    <>
      {next.name} starts in{' '}
      <span className="font-semibold text-text tabular-nums">
        {formatCountdown(Date.parse(next.startsAt) - season.now)}
      </span>
      <span className="hidden sm:inline">, {startText(next.startsAt)}</span>.
    </>
  )
}

function Between({ season }: { season: Running }) {
  const me = useMe()
  const { data: fame } = useHallOfFame()
  const record = recordFor(fame, season.current.id)
  const winner = record?.places[0]
  const mine = record?.places.find((p) => p.userId === me.id)

  let lead
  let detail
  if (record && winner) {
    lead = (
      <>
        {winner.userId === me.id ? 'You won' : `${winner.displayName} won`} {record.name}
        <span className="font-normal text-muted"> with </span>
        <span className="text-(--podium-first) tabular-nums">{formatChips(winner.netWorth)}</span>
        {winner.userId === me.id ? '!' : '.'}
      </>
    )
    detail = (
      <>
        {mine && mine.rank > 1 && (
          <>
            You finished <span className="font-semibold text-text">{ordinal(mine.rank)}</span>.{' '}
          </>
        )}
        <NextLine season={season} />
      </>
    )
  } else {
    lead = <>{season.current.name} is over.</>
    detail =
      fame?.pending?.id === season.current.id ? (
        <>The final standings are being settled while the last open rounds play out.</>
      ) : (
        <NextLine season={season} />
      )
  }

  return (
    <section
      aria-label="Season over"
      data-season="between"
      className="relative overflow-hidden border-b border-border bg-surface-1"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-80 bg-linear-to-r from-[color-mix(in_oklab,var(--podium-first)_10%,transparent)] to-transparent"
      />
      <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 md:px-8">
        {winner ? (
          <span className="relative shrink-0">
            <Avatar player={winner} size="md" className="outline-2 outline-offset-2 outline-gold" />
          </span>
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            <FlagIcon className="size-4.5" />
          </span>
        )}
        <div className="min-w-0 flex-1 leading-snug">
          <p className="truncate text-sm font-semibold">{lead}</p>
          <p className="text-xs text-muted">{detail}</p>
        </div>
        {record && record.places.length > 0 && (
          <Button
            variant="gold"
            size="sm"
            className="shrink-0"
            onClick={() => openPodium(record.id)}
          >
            Podium
          </Button>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- the slot

export function SeasonBanner() {
  const season = useSeasonNow()
  if (!season?.current) return null
  const running = season as Running
  if (season.phase === 'final_day') return <FinalDay season={running} />
  if (season.phase === 'over') return <Between season={running} />
  return null
}
