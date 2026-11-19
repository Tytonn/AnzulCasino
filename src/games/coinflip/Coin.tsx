/**
 * The coin. It starts spinning the moment the player bets, so something moves
 * within 100ms, and lands on the server's answer over the reveal. A new bet
 * while it is still landing finishes that landing at once (spec: Motion:
 * "running animations finish early"), so a fast player never waits.
 *
 *   const coin = useRef<CoinHandle>(null)
 *   coin.current?.toss()                          // as the bet goes out
 *   coin.current?.land('tails', 600, onLanded)    // when the answer arrives
 */
import {
  animate,
  type AnimationPlaybackControls,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react'
import { type Ref, useImperativeHandle, useRef } from 'react'

import type { CoinflipDetail, Side } from '../../../shared/games/coinflip.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { CrownIcon, StarIcon } from '../../kit/icons.tsx'

export interface CoinHandle {
  /** Starts the coin spinning, before the answer is known. */
  toss(): void
  /** Lands on `face` over `ms`, then calls `onLanded`, also when a new toss cuts it short. */
  land(face: Side, ms: number, onLanded: () => void): void
  /** Puts the coin down on `face` at once: a failed bet, or a page load. */
  rest(face: Side): void
}

/** Degrees per second while waiting for the answer. */
const SPIN_SPEED = 1_440

/** The rotation that shows `face`, at least `turns` full turns past `from`. */
export function landingAngle(from: number, face: Side, turns: number): number {
  const offset = face === 'heads' ? 0 : 180
  const min = from + turns * 360
  return Math.ceil((min - offset) / 360) * 360 + offset
}

/** Which face a rotation shows. */
export function faceAt(angle: number): Side {
  const turned = ((angle % 360) + 360) % 360
  return turned > 90 && turned < 270 ? 'tails' : 'heads'
}

const FACE_ICONS = { heads: CrownIcon, tails: StarIcon } as const

function Face({ side }: { side: Side }) {
  const Icon = FACE_ICONS[side]
  return (
    <div
      className="absolute inset-0 grid place-items-center rounded-full [backface-visibility:hidden]"
      style={{
        transform: side === 'tails' ? 'rotateX(180deg)' : undefined,
        background:
          'radial-gradient(circle at 34% 28%, var(--coin-shine), var(--coin) 42%, color-mix(in oklab, var(--coin) 70%, var(--coin-edge)) 100%)',
        boxShadow:
          'inset 0 0 0 0.35em var(--coin-edge), inset 0 0 0 0.5em color-mix(in oklab, var(--coin-shine) 70%, transparent), inset 0 -0.6em 1.2em color-mix(in oklab, var(--coin-edge) 45%, transparent)',
      }}
    >
      <Icon className="size-[46%]" style={{ color: 'var(--coin-ink)' }} />
    </div>
  )
}

export function Coin({
  initialFace,
  className = '',
  ref,
}: {
  initialFace: Side
  /** Sets the coin's size, such as `size-40 text-[10px]`: the rim scales with the font size. */
  className?: string
  ref?: Ref<CoinHandle>
}) {
  const reduced = useReducedMotion()
  const angle = useMotionValue(initialFace === 'tails' ? 180 : 0)
  const lift = useMotionValue(0)
  const shadowScale = useTransform(lift, [-140, 0], [0.45, 1])
  const shadowOpacity = useTransform(lift, [-140, 0], [0.25, 0.6])

  const running = useRef<AnimationPlaybackControls[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<{ target: number; done: () => void } | null>(null)

  function stopAll() {
    for (const controls of running.current) controls.stop()
    running.current = []
    clearTimeout(timer.current)
  }

  /** Ends a landing in progress at its last frame, and reports it landed. */
  function finishLanding() {
    const landing = pending.current
    if (!landing) return
    pending.current = null
    stopAll()
    angle.jump(landing.target)
    lift.jump(0)
    landing.done()
  }

  useImperativeHandle(ref, () => ({
    toss() {
      finishLanding()
      stopAll()
      if (reduced) return
      const from = angle.get()
      running.current = [
        animate(angle, from + SPIN_SPEED * 20, { duration: 20, ease: 'linear' }),
        animate(lift, -120, { duration: 0.28, ease: [0.22, 1, 0.36, 1] }),
      ]
    },
    land(face, ms, onLanded) {
      finishLanding()
      stopAll()
      const seconds = Math.max(0.05, ms / 1000)
      const target = reduced
        ? landingAngle(angle.get(), face, 0)
        : landingAngle(angle.get(), face, 2)
      pending.current = { target, done: onLanded }
      if (reduced) {
        angle.jump(target)
        lift.jump(0)
        // Still wait out the reveal, so the news and the coin agree.
        timer.current = setTimeout(finishLanding, ms)
        return
      }
      running.current = [
        animate(angle, target, {
          duration: seconds,
          ease: [0.18, 0.9, 0.3, 1],
          onComplete: finishLanding,
        }),
        animate(lift, [lift.get(), -70, 0], {
          duration: seconds,
          times: [0, 0.35, 1],
          ease: ['easeOut', 'easeIn'],
        }),
      ]
    },
    rest(face) {
      pending.current = null
      stopAll()
      angle.jump(face === 'tails' ? 180 : 0)
      lift.jump(0)
    },
  }))

  return (
    <div className={`relative [perspective:900px] ${className}`}>
      <motion.div
        aria-hidden="true"
        className="absolute -bottom-[14%] left-1/2 h-[12%] w-[70%] -translate-x-1/2 rounded-[50%] bg-bg blur-[3px]"
        style={{ scale: shadowScale, opacity: shadowOpacity }}
      />
      <motion.div
        className="relative size-full [transform-style:preserve-3d]"
        style={{ rotateX: angle, y: lift }}
      >
        <Face side="heads" />
        <Face side="tails" />
      </motion.div>
    </div>
  )
}

/**
 * The small coin on another player's seat: spinning while their flip is in
 * the air, then showing how it landed. It keeps its size with no flip yet,
 * so the seat does not jump when one arrives.
 */
export function MiniCoin({ round }: { round: RoundView<CoinflipDetail> | null }) {
  const reduced = useReducedMotion()
  if (!round) {
    return (
      <div className="flex flex-col items-center gap-1 py-1 opacity-35">
        <div className="relative size-9 text-[4px]">
          <Face side="heads" />
        </div>
        <p className="text-[0.7rem] text-faint max-md:hidden">No flips yet</p>
      </div>
    )
  }
  const face = round.detail.face
  const flying = round.status === 'open' || face === null
  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <motion.div
        key={flying ? 'flying' : `${round.id}-${face}`}
        className="relative size-9 text-[4px] [perspective:300px]"
        initial={flying || reduced ? false : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 24 }}
      >
        <motion.div
          className="relative size-full [transform-style:preserve-3d]"
          initial={{ rotateX: face === 'tails' ? 180 : 0 }}
          animate={
            flying && !reduced ? { rotateX: [0, 360] } : { rotateX: face === 'tails' ? 180 : 0 }
          }
          transition={
            flying && !reduced
              ? { repeat: Infinity, duration: 0.4, ease: 'linear' }
              : { duration: 0 }
          }
        >
          <Face side="heads" />
          <Face side="tails" />
        </motion.div>
      </motion.div>
      <p className="text-[0.7rem] text-faint max-md:hidden">
        {flying ? 'Flipping…' : `Called ${round.detail.call}`}
      </p>
    </div>
  )
}
