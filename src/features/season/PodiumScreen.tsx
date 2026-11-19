/**
 * The podium screen (spec: Seasons: "After the end, the site shows a podium
 * screen"): over the whole page, the winner, the podium, where the player
 * finished and when the next season starts, under falling confetti. It opens
 * by itself once per season (Overlay.tsx), and from the banner after that.
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type CSSProperties, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router'

import { formatChips } from '../../../shared/chips.ts'
import type { SeasonRecord } from '../../../shared/features/season.ts'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown } from '../../kit/clock.ts'
import { CloseIcon } from '../../kit/icons.tsx'
import { useMe } from '../../kit/queries.ts'
import { playSound } from '../../kit/sfx.ts'
import {
  closePodium,
  ordinal,
  recordFor,
  seasonDates,
  startText,
  useHallOfFame,
  usePodium,
  useSeasonNow,
} from './data.ts'
import { Podium } from './Podium.tsx'

// ---------------------------------------------------------------- confetti

const PIECES = 46
const COLORS = [
  'var(--podium-first)',
  'var(--podium-second)',
  'var(--podium-third)',
  'var(--accent)',
  'var(--podium-first)',
]

/** Paper falling from above the screen, once. Spread by index, so it is the same each render. */
function Confetti() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      {Array.from({ length: PIECES }, (_, i) => {
        const left = (i * 61 + 7) % 100
        const sway = ((i * 37) % 9) - 4
        const duration = 2.8 + ((i * 13) % 14) / 10
        const delay = ((i * 7) % 10) / 10
        const turn = (i % 2 === 0 ? 1 : -1) * (240 + ((i * 53) % 300))
        const round = i % 4 === 0
        return (
          <motion.span
            key={i}
            className={`absolute -top-6 block ${round ? 'size-2.5 rounded-full' : 'h-3 w-1.5 rounded-[1px]'}`}
            style={{ left: `${left}%`, backgroundColor: COLORS[i % COLORS.length] }}
            initial={{ y: 0, x: 0, rotate: 0, opacity: 1 }}
            animate={{
              y: '110vh',
              x: [0, sway * 6, sway * -4, sway * 5],
              rotate: turn,
              opacity: [1, 1, 1, 0],
            }}
            transition={{ duration, delay, ease: 'linear' }}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- the screen

function Screen({ record }: { record: SeasonRecord }) {
  const me = useMe()
  const season = useSeasonNow()
  const navigate = useNavigate()
  const location = useLocation()
  const reduced = useReducedMotion() ?? false
  const panel = useRef<HTMLDivElement>(null)

  const winner = record.places[0]
  const mine = record.places.find((p) => p.userId === me.id)
  const next = season?.next && Date.parse(season.next.startsAt) > season.now ? season.next : null
  // The season that just ended says what comes next; a replay of an older one does not.
  const justEnded = season?.current?.id === record.id && season.phase === 'over'
  const onHallOfFame = location.pathname === '/hall-of-fame'

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    panel.current?.focus()
    // A page that has not been touched yet cannot play sound: stay quiet then.
    if (navigator.userActivation?.hasBeenActive ?? true) {
      playSound(mine && mine.rank <= 3 ? 'bigwin' : 'sparkle')
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePodium()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      before?.focus?.()
    }
    // Once per opening: the sound and the focus belong to the moment it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const title = !winner
    ? `${record.name} is over`
    : winner.userId === me.id
      ? `You won ${record.name}!`
      : `${winner.displayName} wins ${record.name}`

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      <div
        className="fixed inset-0 bg-backdrop backdrop-blur-sm"
        onClick={closePodium}
        aria-hidden="true"
      />
      {!reduced && <Confetti />}
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="season-podium-title"
        tabIndex={-1}
        data-season="podium"
        className="relative w-full max-w-[30rem] overflow-hidden rounded-lg border border-[color-mix(in_oklab,var(--podium-first)_40%,var(--border))] bg-surface-1 shadow-pop outline-none"
        style={{ '--tone': 'var(--podium-first)' } as CSSProperties}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklab,var(--tone)_22%,transparent),transparent_70%)]"
        />
        <button
          type="button"
          onClick={closePodium}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 z-10 grid size-9 place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-text active:scale-95"
        >
          <CloseIcon className="size-5" />
        </button>

        <header className="relative px-6 pt-7 text-center">
          <p className="text-[0.7rem] font-semibold tracking-[0.2em] text-(--tone) uppercase">
            Final standings
          </p>
          <h2
            id="season-podium-title"
            className="mt-1.5 text-2xl leading-tight font-black tracking-tight text-balance md:text-3xl"
          >
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {seasonDates(record.startsAt, record.endsAt)} · {record.places.length}{' '}
            {record.places.length === 1 ? 'player' : 'players'}
          </p>
        </header>

        <div className="relative px-4 pt-6">
          <Podium places={record.places} size="lg" me={me.id} />
        </div>

        <div className="relative space-y-3 border-t border-border bg-surface-2/50 px-5 py-4 text-center">
          {mine && (
            <p className="text-sm">
              {mine.rank === 1 ? (
                <span className="font-semibold text-(--tone)">
                  First of {record.places.length}, with {formatChips(mine.netWorth)}. Well played.
                </span>
              ) : (
                <>
                  You finished{' '}
                  <span
                    className={`font-semibold ${mine.rank <= 3 ? 'text-(--tone)' : 'text-text'}`}
                  >
                    {ordinal(mine.rank)} of {record.places.length}
                  </span>{' '}
                  with{' '}
                  <span className="font-semibold tabular-nums">{formatChips(mine.netWorth)}</span>.
                </>
              )}
            </p>
          )}
          {justEnded && (
            <p className="text-xs text-muted">
              {next ? (
                <>
                  {next.name} starts in{' '}
                  <span className="font-semibold text-text tabular-nums">
                    {formatCountdown(Date.parse(next.startsAt) - (season?.now ?? 0))}
                  </span>
                  , {startText(next.startsAt)}. Everyone starts fresh.
                </>
              ) : (
                'The next season is not scheduled yet.'
              )}
            </p>
          )}
          <div className="flex justify-center gap-2 pt-1">
            {!onHallOfFame && (
              <Button
                variant="secondary"
                onClick={() => {
                  closePodium()
                  void navigate('/hall-of-fame')
                }}
              >
                Hall of Fame
              </Button>
            )}
            <Button variant="gold" onClick={closePodium} className="min-w-28">
              Close
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

/** Drawn once, by the season's overlay. */
export function PodiumLayer() {
  const seasonId = usePodium((s) => s.seasonId)
  const { data: fame } = useHallOfFame(seasonId !== null)
  const record = seasonId === null ? null : recordFor(fame, seasonId)
  return createPortal(
    <AnimatePresence>{record && <Screen key={record.id} record={record} />}</AnimatePresence>,
    document.body,
  )
}
