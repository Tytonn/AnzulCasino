/**
 * The podium: second, first and third side by side, first in the middle and
 * highest (spec: Seasons: "After the end, the site shows a podium screen").
 * The blocks rise third, second, first, each carrying its player up, and the
 * winner's crown lands last.
 */
import { motion, useReducedMotion } from 'motion/react'
import type { CSSProperties } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import type { SeasonPlace } from '../../../shared/features/season.ts'
import { CrownIcon } from '../../kit/icons.tsx'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { ordinal } from './data.ts'

type Size = 'lg' | 'md'

const PLACES: Record<1 | 2 | 3, { tone: string; height: Record<Size, number>; delay: number }> = {
  1: { tone: 'var(--podium-first)', height: { lg: 132, md: 92 }, delay: 0.5 },
  2: { tone: 'var(--podium-second)', height: { lg: 96, md: 68 }, delay: 0.25 },
  3: { tone: 'var(--podium-third)', height: { lg: 70, md: 50 }, delay: 0.05 },
}

/** Read first, second, third; drawn second, first, third. */
const VISUAL_ORDER = { 1: 'order-2', 2: 'order-1', 3: 'order-3' } as const

function Step({
  place,
  rank,
  size,
  mine,
  animate,
  onPick,
}: {
  place: SeasonPlace
  rank: 1 | 2 | 3
  size: Size
  mine: boolean
  animate: boolean
  onPick?: (userId: string) => void
}) {
  const { tone, height, delay } = PLACES[rank]
  const first = rank === 1
  const rise = { type: 'spring', stiffness: 150, damping: 19, delay } as const

  const who = (
    <>
      <span className="relative">
        {first && (
          <motion.span
            aria-hidden="true"
            className={`absolute left-1/2 -translate-x-1/2 text-(--podium-first) drop-shadow-[0_2px_6px_color-mix(in_oklab,var(--podium-first)_45%,transparent)] ${
              size === 'lg' ? '-top-6' : '-top-5'
            }`}
            initial={animate ? { y: -26, opacity: 0, rotate: -24, scale: 0.6 } : false}
            animate={{ y: 0, opacity: 1, rotate: -8, scale: 1 }}
            transition={{ type: 'spring', stiffness: 520, damping: 14, delay: animate ? 1.2 : 0 }}
          >
            <CrownIcon className={size === 'lg' ? 'size-7' : 'size-5'} />
          </motion.span>
        )}
        <Avatar
          player={place}
          size={first ? (size === 'lg' ? 'xl' : 'lg') : size === 'lg' ? 'lg' : 'md'}
          className="outline-2 outline-offset-2 outline-(--tone)"
        />
      </span>
      <span className="flex max-w-full min-w-0 flex-col items-center leading-tight">
        <PlayerName
          player={place}
          className={`max-w-full ${size === 'lg' && first ? 'text-base' : 'text-sm'}`}
        />
        <span
          className={`mt-0.5 font-semibold tabular-nums ${first ? 'text-(--podium-first)' : 'text-muted'} ${
            size === 'lg' ? 'text-sm' : 'text-xs'
          }`}
        >
          {formatChips(place.netWorth)}
        </span>
        {mine && (
          <span className="mt-1 rounded-full bg-accent/15 px-1.5 py-px text-[0.6rem] font-bold tracking-wide text-accent-strong uppercase">
            You
          </span>
        )}
      </span>
    </>
  )

  return (
    <li
      className={`flex min-w-0 flex-1 flex-col items-center justify-end ${VISUAL_ORDER[rank]}`}
      style={{ '--tone': tone } as CSSProperties}
      aria-label={`${ordinal(rank)}: ${place.displayName}, ${formatChips(place.netWorth)}`}
    >
      {/* The player rides up on the block. Only transforms move, so nothing around it shifts. */}
      <motion.div
        className="relative z-10 flex w-full min-w-0 flex-col items-center"
        initial={animate ? { y: height[size], opacity: 0 } : false}
        animate={{ y: 0, opacity: 1 }}
        transition={{ y: rise, opacity: { duration: 0.3, delay } }}
      >
        {onPick ? (
          <button
            type="button"
            onClick={() => onPick(place.userId)}
            className={`flex w-full min-w-0 flex-col items-center gap-2 rounded-md px-1 pt-1 pb-2.5 hover:bg-surface-3/50 ${first ? 'pt-6' : ''}`}
          >
            {who}
          </button>
        ) : (
          <div
            className={`flex w-full min-w-0 flex-col items-center gap-2 px-1 pt-1 pb-2.5 ${first ? 'pt-6' : ''}`}
          >
            {who}
          </div>
        )}
      </motion.div>
      <motion.div
        aria-hidden="true"
        className="relative w-full origin-bottom overflow-hidden rounded-t-md border border-b-0 border-[color-mix(in_oklab,var(--tone)_45%,var(--border))] bg-linear-to-b from-[color-mix(in_oklab,var(--tone)_26%,var(--surface-2))] to-[color-mix(in_oklab,var(--tone)_6%,var(--surface-1))] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--tone)_55%,transparent)]"
        style={{ height: height[size] }}
        initial={animate ? { scaleY: 0 } : false}
        animate={{ scaleY: 1 }}
        transition={rise}
      >
        <motion.span
          className={`absolute inset-x-0 top-1.5 text-center leading-none font-black text-(--tone) ${
            size === 'lg' ? 'text-4xl' : 'text-2xl'
          }`}
          initial={animate ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: delay + 0.45 }}
        >
          {rank}
        </motion.span>
      </motion.div>
    </li>
  )
}

export function Podium({
  places,
  size = 'md',
  me,
  onPick,
}: {
  /** The season's places, best first. Only the top three are drawn. */
  places: readonly SeasonPlace[]
  size?: Size
  /** The viewer's id, to mark their own step. */
  me?: string
  /** Opens a player's card. Leave out where nothing should open. */
  onPick?: (userId: string) => void
}) {
  const reduced = useReducedMotion() ?? false
  const top = ([1, 2, 3] as const).flatMap((rank) => {
    const place = places.find((p) => p.rank === rank)
    return place ? [{ rank, place }] : []
  })
  if (top.length === 0) return null
  return (
    <ol
      aria-label="Podium"
      className={`mx-auto flex w-full items-end justify-center gap-1.5 ${size === 'lg' ? 'max-w-[26rem]' : 'max-w-[22rem]'}`}
    >
      {top.map(({ rank, place }) => (
        <Step
          key={place.userId}
          place={place}
          rank={rank}
          size={size}
          mine={place.userId === me}
          animate={!reduced}
          onPick={onPick}
        />
      ))}
    </ol>
  )
}
