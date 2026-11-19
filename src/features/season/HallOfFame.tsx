/**
 * The Hall of Fame (/hall-of-fame; spec: Seasons: "the Hall of Fame keeps
 * every past season's standings"). The latest finished season in full, with
 * its podium and table; every season before it in a list that opens; and,
 * once there are two or more, who has won the most. Standings are frozen
 * when a season ends and never change.
 */
import { motion, useReducedMotion } from 'motion/react'
import { type CSSProperties, useState } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import type { SeasonPlace, SeasonRecord } from '../../../shared/features/season.ts'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown } from '../../kit/clock.ts'
import { CrownIcon, SparkleIcon } from '../../kit/icons.tsx'
import { TABLET, useMediaQuery } from '../../kit/media.ts'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { useMe } from '../../kit/queries.ts'
import { useTitle } from '../../shell/title.ts'
import { useUi } from '../../shell/ui.ts'
import { openPodium, ordinal, seasonDates, useHallOfFame, useSeasonNow } from './data.ts'
import { ChevronIcon, HourglassIcon } from './icons.tsx'
import { Podium } from './Podium.tsx'

const PLACE_TONES: Record<number, string> = {
  1: 'var(--podium-first)',
  2: 'var(--podium-second)',
  3: 'var(--podium-third)',
}

function playersText(n: number): string {
  return n === 1 ? '1 player' : `${n} players`
}

// ---------------------------------------------------------------- the standings table

function PlaceMark({ rank }: { rank: number }) {
  const tone = PLACE_TONES[rank]
  if (!tone) {
    return (
      <span className="w-6 shrink-0 text-center text-xs font-bold text-faint tabular-nums">
        {rank}
      </span>
    )
  }
  return (
    <span
      className="grid size-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--tone)_20%,var(--surface-2))] text-xs font-black text-(--tone) shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--tone)_45%,transparent)]"
      style={{ '--tone': tone } as CSSProperties}
    >
      {rank}
    </span>
  )
}

function Standings({ record }: { record: SeasonRecord }) {
  const me = useMe()
  const showProfile = useUi((s) => s.showProfile)
  const leader = record.places[0]?.netWorth ?? 0
  return (
    <div>
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5 text-[0.65rem] font-semibold tracking-[0.12em] text-faint uppercase">
        <span>Final standings</span>
        <span>Net worth</span>
      </div>
      <ol className="pb-2">
        {record.places.map((place: SeasonPlace) => {
          const mine = place.userId === me.id
          return (
            <li key={place.userId}>
              <button
                type="button"
                onClick={() => showProfile(place.userId)}
                aria-current={mine ? 'true' : undefined}
                className={`relative flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2 ${
                  mine ? 'bg-accent/10 shadow-[inset_2px_0_0_var(--accent)] hover:bg-accent/15' : ''
                }`}
              >
                <PlaceMark rank={place.rank} />
                <Avatar player={place} size="sm" />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <PlayerName player={place} className="min-w-0" />
                  {mine && (
                    <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-[0.6rem] font-bold tracking-wide text-accent-strong uppercase">
                      You
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end leading-tight">
                  <span
                    className={`font-semibold tabular-nums ${place.rank === 1 ? 'text-gold' : 'text-text'}`}
                  >
                    {formatChips(place.netWorth)}
                  </span>
                  {place.rank > 1 && leader > place.netWorth && (
                    <span className="text-[0.68rem] text-faint tabular-nums">
                      −{formatChips(leader - place.netWorth)}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The podium on its stage, lit from below; beside the table on a wide screen. */
function Stage({ record }: { record: SeasonRecord }) {
  const me = useMe()
  const showProfile = useUi((s) => s.showProfile)
  const wide = useMediaQuery(TABLET)
  return (
    <div className="relative flex flex-col justify-end overflow-hidden border-b border-border bg-linear-to-b from-surface-1 to-surface-2/60 px-3 pt-10 md:border-r md:border-b-0">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_50%_100%,color-mix(in_oklab,var(--podium-first)_13%,transparent),transparent)]"
      />
      <Button
        variant="ghost"
        size="sm"
        className="absolute top-2 right-2"
        onClick={() => openPodium(record.id)}
        aria-label={`Replay the podium for ${record.name}`}
      >
        <SparkleIcon className="size-3.5" aria-hidden="true" />
        Replay
      </Button>
      <div className="relative">
        <Podium places={record.places} size={wide ? 'lg' : 'md'} me={me.id} onPick={showProfile} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- a season

function Finish({ record }: { record: SeasonRecord }) {
  const me = useMe()
  const mine = record.places.find((p) => p.userId === me.id)
  if (!mine) return null
  const tone = PLACE_TONES[mine.rank]
  return (
    <p
      className="shrink-0 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs text-muted"
      style={tone ? ({ '--tone': tone } as CSSProperties) : undefined}
    >
      You finished{' '}
      <span className={`font-bold ${tone ? 'text-(--tone)' : 'text-text'}`}>
        {ordinal(mine.rank)}
      </span>
    </p>
  )
}

function Latest({ record }: { record: SeasonRecord }) {
  const me = useMe()
  const winner = record.places[0]
  return (
    <article
      aria-labelledby={`season-${record.id}`}
      data-season="latest"
      className="overflow-hidden rounded-lg border border-border bg-surface-1 shadow-card"
    >
      <header className="relative flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,color-mix(in_oklab,var(--podium-first)_12%,transparent),transparent_60%)]"
        />
        <div className="relative min-w-0">
          <p className="text-[0.65rem] font-semibold tracking-[0.16em] text-gold uppercase">
            Latest season
          </p>
          <h2 id={`season-${record.id}`} className="mt-0.5 text-xl font-bold tracking-tight">
            {record.name}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {seasonDates(record.startsAt, record.endsAt)} · {playersText(record.places.length)}
            {winner && (
              <>
                {' '}
                · won by{' '}
                <span className="font-semibold text-text">
                  {winner.userId === me.id ? 'you' : winner.displayName}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="relative">
          <Finish record={record} />
        </div>
      </header>
      <div className="grid md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Stage record={record} />
        <Standings record={record} />
      </div>
    </article>
  )
}

function Earlier({ record }: { record: SeasonRecord }) {
  const me = useMe()
  const [open, setOpen] = useState(false)
  const winner = record.places[0]
  const mine = record.places.find((p) => p.userId === me.id)
  return (
    <li>
      <details
        className="group overflow-hidden rounded-lg border border-border bg-surface-1 open:shadow-card"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 select-none hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{record.name}</p>
            <p className="text-xs text-muted">
              {seasonDates(record.startsAt, record.endsAt)}
              {mine && <> · you were {ordinal(mine.rank)}</>}
            </p>
          </div>
          {winner && (
            <span className="flex min-w-0 items-center gap-2">
              <CrownIcon className="size-4 shrink-0 text-gold" aria-hidden="true" />
              <Avatar player={winner} size="xs" />
              <span className="hidden max-w-36 min-w-0 sm:inline-flex">
                <PlayerName player={winner} className="text-sm" />
              </span>
              <span className="text-sm font-semibold text-gold tabular-nums">
                {formatChips(winner.netWorth)}
              </span>
            </span>
          )}
          <ChevronIcon
            className="size-4 shrink-0 text-faint transition-transform duration-200 group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        {open && (
          <div className="border-t border-border md:grid md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <Stage record={record} />
            <Standings record={record} />
          </div>
        )}
      </details>
    </li>
  )
}

// ---------------------------------------------------------------- who has won the most

interface Champion {
  place: SeasonPlace
  titles: number
  podiums: number
}

function champions(seasons: readonly SeasonRecord[]): Champion[] {
  const byPlayer = new Map<string, Champion>()
  // Newest first, so each player keeps their latest look.
  for (const record of seasons) {
    for (const place of record.places) {
      if (place.rank > 3) continue
      const found = byPlayer.get(place.userId) ?? { place, titles: 0, podiums: 0 }
      found.podiums += 1
      if (place.rank === 1) found.titles += 1
      byPlayer.set(place.userId, found)
    }
  }
  return [...byPlayer.values()]
    .filter((c) => c.titles > 0)
    .sort((a, b) => b.titles - a.titles || b.podiums - a.podiums)
}

function Champions({ seasons }: { seasons: readonly SeasonRecord[] }) {
  const showProfile = useUi((s) => s.showProfile)
  const list = champions(seasons)
  if (list.length === 0) return null
  return (
    <section aria-labelledby="hof-champions">
      <h2
        id="hof-champions"
        className="mb-2 text-[0.7rem] font-semibold tracking-[0.12em] text-faint uppercase"
      >
        Most titles
      </h2>
      <ul className="flex flex-wrap gap-2">
        {list.map((c) => (
          <li key={c.place.userId}>
            <button
              type="button"
              onClick={() => showProfile(c.place.userId)}
              className="flex items-center gap-2.5 rounded-full border border-border bg-surface-1 py-1 pr-3.5 pl-1 hover:border-border-strong hover:bg-surface-2"
            >
              <Avatar player={c.place} size="sm" />
              <span className="flex flex-col items-start leading-tight">
                <PlayerName player={c.place} className="text-sm" />
                <span className="text-[0.68rem] text-muted">
                  <span className="font-semibold text-gold">
                    {c.titles} {c.titles === 1 ? 'title' : 'titles'}
                  </span>{' '}
                  · {c.podiums} {c.podiums === 1 ? 'podium' : 'podiums'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---------------------------------------------------------------- waiting, empty, loading

function Settling({ name }: { name: string }) {
  const reduced = useReducedMotion() ?? false
  return (
    <section
      data-season="settling"
      className="flex items-center gap-3.5 rounded-lg border border-[color-mix(in_oklab,var(--gold)_35%,var(--border))] bg-[color-mix(in_oklab,var(--gold)_7%,var(--surface-1))] p-4"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-gold">
        <motion.span
          className="block"
          animate={reduced ? undefined : { rotate: [0, 0, 180] }}
          transition={{ duration: 3, times: [0, 0.75, 1], repeat: Infinity, ease: 'easeInOut' }}
        >
          <HourglassIcon className="size-5" />
        </motion.span>
      </span>
      <div className="min-w-0">
        <p className="font-semibold">{name} has ended</p>
        <p className="text-sm text-muted">
          Its final standings are being settled while the last open rounds play out. They land here
          in a moment.
        </p>
      </div>
    </section>
  )
}

function Empty() {
  const season = useSeasonNow()
  const current = season?.current
  const running = current && (season.phase === 'open' || season.phase === 'final_day')
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface-1/50 px-6 py-14 text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-full bg-surface-2 text-gold shadow-[0_0_0_6px_color-mix(in_oklab,var(--gold)_8%,transparent)]">
        <CrownIcon className="size-8" />
      </div>
      <h2 className="mt-5 text-lg font-semibold">No season has finished yet</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
        {running ? (
          <>
            {current.name} ends in{' '}
            <span className="font-semibold text-text tabular-nums">
              {formatCountdown(Date.parse(current.endsAt) - season.now)}
            </span>
            . Its podium and final standings land here the moment it does.
          </>
        ) : (
          'The first podium and final standings land here when the first season ends.'
        )}
      </p>
    </div>
  )
}

function Loading() {
  return (
    <div aria-label="Loading the Hall of Fame" className="space-y-4">
      <div className="skeleton h-24 rounded-lg" />
      <div className="skeleton h-80 rounded-lg" />
    </div>
  )
}

// ---------------------------------------------------------------- the page

export default function HallOfFamePage() {
  useTitle('Hall of Fame')
  const { data, isPending, isError, refetch } = useHallOfFame()

  let body
  if (isPending) body = <Loading />
  else if (isError) {
    body = (
      <div className="rounded-lg border border-border bg-surface-1 p-6 text-center">
        <p className="text-sm text-muted">The Hall of Fame did not load.</p>
        <Button className="mt-3" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    )
  } else if (data.seasons.length === 0) {
    body = data.pending ? null : <Empty />
  } else {
    const [latest, ...earlier] = data.seasons
    body = (
      <>
        {data.seasons.length >= 2 && <Champions seasons={data.seasons} />}
        {latest && <Latest record={latest} />}
        {earlier.length > 0 && (
          <section aria-labelledby="hof-earlier">
            <h2
              id="hof-earlier"
              className="mb-2 text-[0.7rem] font-semibold tracking-[0.12em] text-faint uppercase"
            >
              Earlier seasons
            </h2>
            <ul className="space-y-2">
              {earlier.map((record) => (
                <Earlier key={record.id} record={record} />
              ))}
            </ul>
          </section>
        )}
      </>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8">
      <header>
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight md:text-3xl">
          <CrownIcon className="size-7 text-gold" aria-hidden="true" />
          Hall of Fame
        </h1>
        <p className="mt-1 text-sm text-muted">
          Every season’s final standings, frozen the moment it ended.
        </p>
      </header>
      {data?.pending && <Settling name={data.pending.name} />}
      {body}
    </div>
  )
}
