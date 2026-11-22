/**
 * A number as the wheel colors it: a small tile for lines and lists, and a
 * big one for the result on the card. Also its name in words, "17 Black".
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

/** "17 Black", "0 Green". */
export function numberWords(n: number): string {
  return `${n} ${COLOR_NAMES[pocketColor(n)]}`
}
