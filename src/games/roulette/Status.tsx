/**
 * What the wheel is doing, in words: the countdown while bets are open,
 * "No more bets" at the close, the spin, and the number with what it did
 * for you. Also the strip of the last 12 numbers (spec: Keys).
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type ReactNode, useEffect, useRef } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import {
  COLOR_NAMES,
  pocketColor,
  type SpinResult,
  type SpinWindow,
} from '../../../shared/games/roulette.ts'
import { playSound, serverNow, useNow } from '../../kit/index.ts'
import type { Stage } from './useSpins.ts'

export const POCKET_FILL = {
  red: 'var(--roulette-red)',
  black: 'var(--roulette-black)',
  green: 'var(--roulette-green)',
} as const

/** "No more bets" shows this long after the close, then "Spinning". */
const CALL_MS = 1_300
/** The countdown turns gold for its last seconds. */
const HURRY_MS = 5_000

/** What the landed spin did for you, in chips. */
export interface MyResult {
  spin: number
  number: number
  stake: bigint
  payout: bigint
}

export function NumberChip({
  number,
  size = 'md',
  className = '',
}: {
  number: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    sm: 'h-6 min-w-6 text-[0.7rem] rounded-md',
    md: 'h-8 min-w-8 text-sm rounded-md',
    lg: 'h-12 min-w-12 text-xl rounded-lg',
  }
  return (
    <span
      className={`inline-grid shrink-0 place-items-center px-1 font-bold tabular-nums ${sizes[size]} ${className}`}
      style={{ backgroundColor: POCKET_FILL[pocketColor(number)], color: 'var(--roulette-digit)' }}
    >
      {number}
    </span>
  )
}

export function numberWords(n: number): string {
  return n === 0 ? '0 Green' : `${n} ${COLOR_NAMES[pocketColor(n)]}`
}

function Outcome({ result }: { result: MyResult | null }) {
  if (!result || result.stake === 0n) return <span className="text-muted">No bets from you</span>
  const net = result.payout - result.stake
  if (net > 0n) return <span className="font-bold text-gold">You won {formatChips(net)}</span>
  if (net === 0n) return <span className="font-semibold text-muted">You broke even</span>
  return <span className="font-semibold text-loss">−{formatChips(-net)}</span>
}

export interface StatusBarProps {
  stage: Stage | null
  shown: SpinWindow | null
  /** The spin taking bets by the clock, for the next one's countdown. */
  window: SpinWindow | null
  number: number | null
  result: MyResult | null
  /** Your chips on the shown spin. */
  riding: bigint
  loading: boolean
  /** No season, or no wallet: why the wheel is idle. */
  idle: string | null
}

/** The strip along the top of the bet panel, with a bar that drains as betting runs out. */
export function StatusBar({
  stage,
  shown,
  window,
  number,
  result,
  riding,
  loading,
  idle,
}: StatusBarProps) {
  useNow(250)
  const reduced = useReducedMotion()
  const now = serverNow()

  let left = 0
  let fill = 0
  let tone = 'bg-accent'
  let text: ReactNode
  let clock: string | null = null

  if (loading) {
    text = <span className="text-muted">Finding the wheel…</span>
  } else if (idle || !shown || !stage) {
    text = <span className="text-muted">{idle ?? 'The wheel starts with the season.'}</span>
  } else if (stage === 'betting') {
    left = Math.max(0, shown.closesAt - now)
    fill = left / Math.max(1, shown.closesAt - shown.opensAt)
    const hurry = left <= HURRY_MS
    tone = hurry ? 'bg-gold' : 'bg-accent'
    clock = String(Math.ceil(left / 1000))
    text = hurry ? (
      <span className="font-semibold text-gold">Last bets</span>
    ) : (
      <span className="font-semibold">Place your bets</span>
    )
  } else if (stage === 'spinning') {
    fill = Math.min(1, (now - shown.closesAt) / Math.max(1, shown.landsAt - shown.closesAt))
    tone = 'bg-border-strong'
    text =
      now - shown.closesAt < CALL_MS ? (
        <span className="font-semibold">No more bets</span>
      ) : (
        <span className="text-muted">
          Spinning…
          {riding > 0n && (
            <span className="text-text tabular-nums"> {formatChips(riding)} riding</span>
          )}
        </span>
      )
  } else if (stage === 'landed' && number !== null) {
    fill = 1
    const won = result !== null && result.payout > result.stake
    tone = won ? 'bg-gold' : 'bg-border-strong'
    text = (
      <span className="flex min-w-0 items-center gap-2">
        <NumberChip number={number} size="sm" />
        <span className="font-semibold">{numberWords(number)}</span>
        <span className="text-faint">·</span>
        <span className="truncate">
          <Outcome result={result} />
        </span>
      </span>
    )
  } else {
    text = <span className="text-muted">No bets this spin, so the wheel rests.</span>
  }

  // Between spins, how long until the next opens.
  if ((stage === 'landed' || stage === 'empty') && window) {
    const next = window.spin === shown?.spin ? window.endsAt : window.opensAt
    if (next > now) clock = `Next ${Math.ceil((next - now) / 1000)}`
  }

  // A tick for each of the last three seconds when you have chips down.
  const second = stage === 'betting' ? Math.ceil(left / 1000) : 0
  const ticked = useRef(0)
  useEffect(() => {
    if (second >= 1 && second <= 3 && riding > 0n && ticked.current !== second) {
      ticked.current = second
      playSound('tick')
    }
    if (second > 3) ticked.current = 0
  }, [second, riding])

  return (
    <div className="relative border-b border-border">
      <div className="absolute inset-x-0 top-0 h-0.75 bg-surface-3">
        <div
          className={`h-full origin-left ${tone} ${reduced ? '' : 'transition-transform duration-250 ease-linear'}`}
          style={{ transform: `scaleX(${fill})` }}
        />
      </div>
      <div
        aria-live="polite"
        className="flex min-h-10 items-center justify-between gap-3 px-3 pt-1 text-sm"
      >
        <span className="min-w-0 truncate">{text}</span>
        {clock && (
          <span
            className={`shrink-0 font-bold tabular-nums ${
              stage === 'betting' && left <= HURRY_MS ? 'text-gold' : 'text-muted'
            }`}
          >
            {clock}
          </span>
        )}
      </div>
    </div>
  )
}

/** The last 12 numbers, newest first. */
export function RecentStrip({
  recent,
  className = '',
}: {
  recent: SpinResult[]
  className?: string
}) {
  const reduced = useReducedMotion()
  if (recent.length === 0) {
    return <p className={`text-xs text-faint ${className}`}>No numbers yet this season.</p>
  }
  return (
    <ol
      aria-label="The last numbers, newest first"
      className={`flex items-center gap-1 ${className}`}
    >
      <AnimatePresence initial={false}>
        {recent.map((r, i) => (
          <motion.li
            key={r.spin}
            layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4, x: -12 }}
            animate={{ opacity: i === 0 ? 1 : Math.max(0.45, 1 - i * 0.05), scale: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <NumberChip
              number={r.number}
              size="sm"
              className={i === 0 ? 'outline-2 outline-offset-1 outline-gold' : ''}
            />
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}
