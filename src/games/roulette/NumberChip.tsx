/**
 * A number as the wheel colors it: a tile for lines, lists and the felt, and
 * a ball for the result on the card. Also its name in words, "17 Black".
 */
import { COLOR_NAMES, pocketColor } from '../../../shared/games/roulette.ts'

export const POCKET_FILL = {
  red: 'var(--roulette-red)',
  black: 'var(--roulette-black)',
  green: 'var(--roulette-green)',
} as const

const SIZES = {
  sm: 'h-6 min-w-6 text-[0.7rem] rounded-md',
  md: 'h-8 min-w-8 text-sm rounded-md',
  lg: 'h-12 min-w-12 text-xl rounded-lg',
  xl: 'h-16 min-w-16 text-3xl rounded-xl',
} as const

export function NumberChip({
  number,
  size = 'md',
  className = '',
}: {
  number: number
  size?: keyof typeof SIZES
  className?: string
}) {
  return (
    <span
      className={`inline-grid shrink-0 place-items-center px-1 font-bold tabular-nums ${SIZES[size]} ${className}`}
      style={{ backgroundColor: POCKET_FILL[pocketColor(number)], color: 'var(--roulette-digit)' }}
    >
      {number}
    </span>
  )
}

const POCKET_DEEP = {
  red: 'var(--roulette-red-deep)',
  black: 'var(--roulette-black-deep)',
  green: 'var(--roulette-green-deep)',
} as const

/** The result on the card: the number on a ball of its color, with a darker rim. */
export function NumberBall({ number, className = '' }: { number: number; className?: string }) {
  const color = pocketColor(number)
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-extrabold tabular-nums ${className}`}
      style={{
        color: 'var(--roulette-digit)',
        background: `radial-gradient(circle at 50% 40%, ${POCKET_FILL[color]} 0 55%, ${POCKET_DEEP[color]} 100%)`,
        boxShadow: `inset 0 0 0 3px ${POCKET_DEEP[color]}, 0 0 0 1px var(--roulette-line), 0 4px 12px var(--roulette-shadow)`,
        textShadow: '0 1px 2px var(--roulette-shadow)',
      }}
    >
      {number}
    </span>
  )
}

/** The ball's place before the draw: a blank one, pulsing once betting has closed. */
export function BlankBall({ waiting, className = '' }: { waiting: boolean; className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full border-2 border-border-strong bg-surface-3 font-extrabold text-muted ${waiting ? 'roulette-pulse' : ''} ${className}`}
    >
      ?
    </span>
  )
}

/** "17 Black", "0 Green". */
export function numberWords(n: number): string {
  return `${n} ${COLOR_NAMES[pocketColor(n)]}`
}
