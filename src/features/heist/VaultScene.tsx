/**
 * The vault the steal dialog cracks: a steel door with a combination dial,
 * bolts and a three-spoke handle. While the request is out the dial clicks
 * through a combination. Then one of three endings plays:
 *
 * - open: the handle turns, the bolts pull back and the door swings open on
 *   a glow of gold chips that burst out;
 * - alarm: red lights sweep the room and the door rattles shut;
 * - blocked: a shield slams down in front of the door.
 *
 * With reduced motion every ending is a short fade, and the dial does not spin.
 */
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import { playSound } from '../../kit/sfx.ts'
import { SirenIcon } from './art.tsx'

export type VaultMood = 'idle' | 'cracking' | 'open' | 'alarm' | 'blocked'

const BOLTS = 8
const DIAL_STEP_MS = 165

/** The combination the dial clicks through: left, right, left, a little further each time. */
const COMBINATION = [62, -48, 118, -36, 154, 70, -94, 26, 190, -12]

export function VaultScene({
  mood,
  big = false,
  className = '',
}: {
  mood: VaultMood
  /** A haul worth a tenth of your net worth or more: twice the chips burst out. */
  big?: boolean
  className?: string
}) {
  const reduced = useReducedMotion() ?? false
  const [clicks, setClicks] = useState(0)

  // The dial clicks through the combination while the request is out.
  useEffect(() => {
    if (mood !== 'cracking' || reduced) return
    let step = 0
    const timer = setInterval(() => {
      step += 1
      setClicks(step)
      playSound('tick')
    }, DIAL_STEP_MS)
    return () => clearInterval(timer)
  }, [mood, reduced])

  const turns = Math.floor(clicks / COMBINATION.length) * 360
  const dial =
    mood === 'cracking'
      ? clicks === 0
        ? 0
        : (COMBINATION[(clicks - 1) % COMBINATION.length] ?? 0) + turns
      : mood === 'open'
        ? 360
        : 0

  const unlocked = mood === 'open'
  const shaking = mood === 'alarm' && !reduced

  return (
    <div
      className={`relative aspect-square select-none ${shaking ? 'heist-shake' : ''} ${className}`}
      style={{ perspective: 900 }}
    >
      {/* The wall and the dark inside of the vault, seen when the door opens. */}
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden="true">
        <defs>
          <radialGradient id="heist-inside-glow" cx="50%" cy="60%" r="55%">
            <stop offset="0" stopColor="var(--gold)" stopOpacity="0.85" />
            <stop offset="0.45" stopColor="var(--gold)" stopOpacity="0.25" />
            <stop offset="1" stopColor="var(--heist-vault-inside)" stopOpacity="1" />
          </radialGradient>
          <linearGradient id="heist-wall" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--heist-steel-dark)" />
            <stop offset="1" stopColor="var(--heist-steel-deep)" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="192" height="192" rx="26" fill="url(#heist-wall)" />
        <rect
          x="4"
          y="4"
          width="192"
          height="192"
          rx="26"
          fill="none"
          stroke="var(--heist-steel)"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        {[22, 178].map((x) =>
          [22, 178].map((y) => (
            <circle
              key={`${x}-${y}`}
              cx={x}
              cy={y}
              r="4.5"
              fill="var(--heist-steel)"
              opacity="0.5"
            />
          )),
        )}
        <circle cx="100" cy="100" r="80" fill="var(--heist-vault-inside)" />
        <motion.circle
          cx="100"
          cy="100"
          r="78"
          fill="url(#heist-inside-glow)"
          initial={false}
          animate={{ opacity: unlocked ? 1 : 0 }}
          transition={{ duration: reduced ? 0.1 : 0.5, delay: unlocked && !reduced ? 0.35 : 0 }}
        />
        {/* The pile of chips inside. */}
        <motion.g
          initial={false}
          animate={{ opacity: unlocked ? 1 : 0 }}
          transition={{ duration: 0.3, delay: unlocked && !reduced ? 0.4 : 0 }}
        >
          {[
            [78, 138],
            [100, 142],
            [122, 138],
            [89, 128],
            [111, 128],
            [100, 118],
          ].map(([x, y], i) => (
            <g key={i}>
              <ellipse
                cx={x}
                cy={(y ?? 0) + 3}
                rx="13"
                ry="6"
                fill="var(--on-gold)"
                opacity="0.6"
              />
              <ellipse cx={x} cy={y} rx="13" ry="6" fill="var(--gold)" />
              <ellipse
                cx={x}
                cy={y}
                rx="8.5"
                ry="3.6"
                fill="none"
                stroke="var(--on-gold)"
                strokeOpacity="0.35"
                strokeWidth="1.4"
                strokeDasharray="3 2.4"
              />
            </g>
          ))}
        </motion.g>
      </svg>

      {/* The door, hinged on the left. */}
      <motion.div
        className="absolute inset-0"
        style={{ transformOrigin: '13% 50%', transformStyle: 'preserve-3d' }}
        initial={false}
        animate={
          reduced ? { opacity: unlocked ? 0 : 1 } : { rotateY: unlocked ? -108 : 0, opacity: 1 }
        }
        transition={
          reduced
            ? { duration: 0.15 }
            : unlocked
              ? { type: 'spring', stiffness: 70, damping: 14, delay: 0.32 }
              : { type: 'spring', stiffness: 260, damping: 26 }
        }
      >
        <svg viewBox="0 0 200 200" className="size-full drop-shadow-xl" aria-hidden="true">
          <defs>
            <linearGradient id="heist-door" x1="0.2" y1="0" x2="0.8" y2="1">
              <stop offset="0" stopColor="var(--heist-steel-light)" />
              <stop offset="0.55" stopColor="var(--heist-steel)" />
              <stop offset="1" stopColor="var(--heist-steel-dark)" />
            </linearGradient>
          </defs>
          {/* Hinges. */}
          <rect x="12" y="62" width="14" height="20" rx="4" fill="var(--heist-steel-dark)" />
          <rect x="12" y="118" width="14" height="20" rx="4" fill="var(--heist-steel-dark)" />
          <circle cx="100" cy="100" r="82" fill="var(--heist-steel-deep)" />
          <circle cx="100" cy="100" r="78" fill="url(#heist-door)" />
          <circle
            cx="100"
            cy="100"
            r="64"
            fill="none"
            stroke="var(--heist-steel-deep)"
            strokeOpacity="0.45"
            strokeWidth="2"
          />
          {/* Bolts around the rim pull back as the lock opens. */}
          {Array.from({ length: BOLTS }, (_, i) => {
            const angle = (i / BOLTS) * Math.PI * 2 + Math.PI / BOLTS
            const out = 71
            const back = 63
            return (
              <motion.circle
                key={i}
                r="4.6"
                fill="var(--heist-steel-deep)"
                stroke="var(--heist-steel-light)"
                strokeOpacity="0.4"
                strokeWidth="1"
                initial={false}
                animate={{
                  cx: 100 + Math.cos(angle) * (unlocked ? back : out),
                  cy: 100 + Math.sin(angle) * (unlocked ? back : out),
                }}
                transition={{ type: 'spring', stiffness: 420, damping: 24, delay: i * 0.012 }}
              />
            )
          })}
        </svg>
        {/* The three-spoke handle turns a quarter as the lock opens. */}
        <motion.div
          className="absolute inset-0"
          initial={false}
          animate={{ rotate: unlocked ? 90 : 0 }}
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 200, damping: 16 }}
        >
          <svg viewBox="0 0 200 200" className="size-full" aria-hidden="true">
            {[0, 120, 240].map((deg) => (
              <g key={deg} transform={`rotate(${deg} 100 100)`}>
                <rect
                  x="96.5"
                  y="40"
                  width="7"
                  height="34"
                  rx="3.5"
                  fill="var(--heist-steel-dark)"
                />
                <circle cx="100" cy="40" r="7" fill="var(--heist-steel-light)" />
              </g>
            ))}
          </svg>
        </motion.div>
        {/* The combination dial. */}
        <motion.div
          className="absolute inset-0"
          initial={false}
          animate={{ rotate: dial }}
          transition={
            reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 30, mass: 0.6 }
          }
        >
          <svg viewBox="0 0 200 200" className="size-full" aria-hidden="true">
            <defs>
              <radialGradient id="heist-dial" cx="40%" cy="35%" r="70%">
                <stop offset="0" stopColor="var(--heist-steel-light)" />
                <stop offset="1" stopColor="var(--heist-steel-dark)" />
              </radialGradient>
            </defs>
            <circle cx="100" cy="100" r="27" fill="url(#heist-dial)" />
            <circle
              cx="100"
              cy="100"
              r="27"
              fill="none"
              stroke="var(--heist-steel-deep)"
              strokeWidth="2"
            />
            {Array.from({ length: 24 }, (_, i) => (
              <line
                key={i}
                x1="100"
                y1={i % 6 === 0 ? 76 : 77.5}
                x2="100"
                y2="80.5"
                stroke="var(--heist-steel-deep)"
                strokeWidth={i % 6 === 0 ? 2 : 1}
                transform={`rotate(${i * 15} 100 100)`}
              />
            ))}
            <circle cx="100" cy="100" r="9" fill="var(--heist-steel-dark)" />
            <path d="M100 86 104 93h-8Z" fill="var(--gold)" />
          </svg>
        </motion.div>
        {/* The fixed marker the dial is read against. */}
        <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden="true">
          <path d="M100 66.5 95.5 59h9Z" fill="var(--loss)" />
        </svg>
      </motion.div>

      {/* Gold chips burst out of the open vault. */}
      {unlocked && !reduced && <ChipBurst count={big ? BURST * 2 : BURST} />}

      {/* Alarm lights. */}
      {mood === 'alarm' && (
        <>
          <div
            className="heist-alarm pointer-events-none absolute -inset-6 rounded-[2rem]"
            style={{
              background:
                'radial-gradient(circle at 15% 10%, var(--heist-alarm-glow), transparent 55%), radial-gradient(circle at 85% 10%, var(--heist-alarm-glow), transparent 55%)',
            }}
          />
          <motion.div
            className="absolute -top-3 left-1/2 grid size-11 -translate-x-1/2 place-items-center rounded-full border-2 border-loss bg-surface-1 text-loss shadow-pop"
            initial={reduced ? { opacity: 0 } : { scale: 0, rotate: -30 }}
            animate={reduced ? { opacity: 1 } : { scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          >
            <SirenIcon className="size-6" />
          </motion.div>
        </>
      )}

      {/* The shield that stops the thief. */}
      {mood === 'blocked' && <ShieldSlam reduced={reduced} />}
    </div>
  )
}

const BURST = 14

function ChipBurst({ count }: { count: number }) {
  return (
    <div className="pointer-events-none absolute top-[58%] left-1/2" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const spread = (i / (count - 1) - 0.5) * 2 // -1 to 1
        const x = spread * (70 + (i % 3) * 18)
        const peak = -(90 + ((i * 29) % 60))
        return (
          <motion.span
            key={i}
            className="absolute block h-3 w-5 -translate-x-1/2 rounded-[50%] bg-gold"
            style={{
              boxShadow:
                'inset 0 -2px 0 color-mix(in oklab, var(--on-gold) 45%, transparent), inset 0 0 0 2px color-mix(in oklab, var(--on-gold) 25%, transparent)',
            }}
            initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.6 }}
            animate={{
              x: [0, x * 0.6, x],
              y: [0, peak, peak + 150],
              opacity: [0, 1, 1, 0],
              rotate: ((i * 67) % 360) - 180,
              scale: 1,
            }}
            transition={{ duration: 1.25, delay: 0.55 + (i % 5) * 0.03, ease: [0.2, 0.7, 0.4, 1] }}
          />
        )
      })}
    </div>
  )
}

function ShieldSlam({ reduced }: { reduced: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      {!reduced && (
        <motion.div
          className="absolute size-3/4 rounded-full border-4"
          style={{ borderColor: 'var(--heist-shield)' }}
          initial={{ scale: 0.5, opacity: 0.9 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 0.65, delay: 0.16, ease: 'easeOut' }}
        />
      )}
      <motion.svg
        viewBox="0 0 120 120"
        className="relative w-3/4 drop-shadow-2xl"
        initial={reduced ? { opacity: 0 } : { scale: 2.1, opacity: 0, y: -50 }}
        animate={reduced ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0.15 } : { type: 'spring', stiffness: 640, damping: 22 }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="heist-slam-face" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--heist-shield)" />
            <stop offset="1" stopColor="var(--heist-shield-deep)" />
          </linearGradient>
        </defs>
        <path
          d="M60 8 100 23v29c0 25-17 43.6-40 49.7C37 95.6 20 77 20 52V23Z"
          fill="url(#heist-slam-face)"
          stroke="var(--heist-steel-light)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="M60 17v75C42.6 86 30 71.6 30 52V29.5Z"
          fill="var(--heist-steel-light)"
          opacity="0.18"
        />
        {/* The check draws itself once the shield lands. */}
        <motion.path
          d="M44.5 52.5 55.5 63.5 75.5 42"
          fill="none"
          stroke="var(--heist-steel-light)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: reduced ? 1 : 0, opacity: 0.9 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.32, delay: reduced ? 0 : 0.28, ease: 'easeOut' }}
        />
      </motion.svg>
    </div>
  )
}
