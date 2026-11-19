/**
 * Win celebrations that scale with the win (spec: Motion): a small win gets
 * a quick tick, and a win of big_win_times the bet or more, or any won
 * all-in, gets the full treatment: particles, a banner and a fanfare. The
 * server posts the big ones in chat. The shell mounts <CelebrationLayer />
 * once; games call celebrate() when their reveal lands.
 *
 *   celebrate({ net: 1_250_00, big: true })
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect } from 'react'
import { create } from 'zustand'

import { formatChips } from '../../shared/chips.ts'
import { playSound } from './sfx.ts'

interface Celebration {
  id: number
  /** What the player won, payout minus stake, in hundredths. */
  net: number
  /** A line under the amount, such as "All in". */
  note?: string
}

const useCelebrations = create<{ current: Celebration | null }>(() => ({ current: null }))
let nextId = 1

/**
 * Celebrates a win. `big` gets the full treatment; anything else is the
 * quick tick (a sound; the game's own numbers flash gold).
 */
export function celebrate(win: { net: number; big: boolean; note?: string }): void {
  if (win.net <= 0) return
  if (!win.big) {
    playSound('win')
    return
  }
  playSound('bigwin')
  useCelebrations.setState({ current: { id: nextId++, net: win.net, note: win.note } })
}

/** Whether a result earns the full treatment, by the same rule the server posts in chat. */
export function isBigWin(
  round: { stake: number; payout: number | null; allIn: boolean },
  bigWinTimes: number,
): boolean {
  const payout = round.payout ?? 0
  return payout > round.stake && (round.allIn || payout >= round.stake * bigWinTimes)
}

const PARTICLES = 36
const COLORS = ['var(--gold)', 'var(--accent)', 'var(--accent-strong)', 'var(--text)']

function Particles({ seed }: { seed: number }) {
  // Positions are random per celebration; stable for its lifetime.
  const pieces = Array.from({ length: PARTICLES }, (_, i) => {
    const angle = ((i + (seed % 7) / 7) / PARTICLES) * Math.PI * 2
    const distance = 140 + ((i * 37 + seed * 13) % 160)
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance - 40,
      rotate: (i * 47) % 360,
      color: COLORS[i % COLORS.length],
      round: i % 3 === 0,
      delay: (i % 6) * 0.015,
    }
  })
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className={`absolute block ${p.round ? 'size-3 rounded-full' : 'h-2 w-3.5 rounded-[2px]'}`}
          style={{ backgroundColor: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4, rotate: 0 }}
          animate={{
            x: p.x,
            y: [0, p.y, p.y + 160],
            opacity: [1, 1, 0],
            scale: 1,
            rotate: p.rotate * 3,
          }}
          transition={{ duration: 1.6, delay: p.delay, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  )
}

const SHOW_MS = 2_400

/** Mount once, above everything. It draws the current big celebration. */
export function CelebrationLayer() {
  const current = useCelebrations((s) => s.current)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (!current) return
    const timer = setTimeout(() => {
      if (useCelebrations.getState().current?.id === current.id) {
        useCelebrations.setState({ current: null })
      }
    }, SHOW_MS)
    return () => clearTimeout(timer)
  }, [current])

  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-live="polite">
      <AnimatePresence>
        {current && (
          <motion.div
            key={current.id}
            className="absolute inset-0 grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {!reduced && <Particles seed={current.id} />}
            <motion.div
              className="rounded-lg border border-gold/50 bg-surface-1/90 px-8 py-5 text-center shadow-pop backdrop-blur-md"
              initial={reduced ? { opacity: 0 } : { scale: 0.6, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
            >
              <p className="text-xs font-semibold tracking-[0.2em] text-gold uppercase">
                {current.note ?? 'Big win'}
              </p>
              <p className="mt-1 text-4xl font-black text-gold tabular-nums md:text-5xl">
                +{formatChips(current.net)}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
