/**
 * The wheel and the ball, as functions of the server's time (spec: "The
 * wheel starts spinning at the close time on every screen and slows onto the
 * number when it arrives"). Nothing is streamed: every screen works out the
 * same angles from the spin's times, so everyone watches the same spin.
 *
 * The wheel turns clockwise at a steady speed, always. At the launch the ball
 * leaves its pocket and runs the other way round the track, slowing as it
 * goes. The number is drawn a moment after the close; from when this screen
 * hears it, the ball's path is bent a little (never more than half a turn,
 * mostly while it is fast) so that it drops off the track, bounces and comes
 * to rest in that pocket exactly when it lands. Then it rides the wheel.
 *
 * Angles are degrees clockwise from the top; times are server epoch ms.
 */
import { POCKETS, WHEEL_ORDER } from '../../../shared/games/roulette.ts'

/** One turn of the wheel. */
export const WHEEL_PERIOD_MS = 9_000
/** The ball's speed at the launch, and as it reaches the drop, in degrees a second. */
const LAUNCH_SPEED = 700
const DROP_SPEED = 75
/** The ball leaves the track this long before it lands, and settles into the pocket over the end of that. */
export const DROP_MS = 1_500
const SETTLE_MS = 900
/** Coming out of the pocket at the launch. */
const LIFT_MS = 450
/** When the number arrives late, the ball still takes this long to land. */
export const MIN_LAND_MS = 2_200

/** Radii on the wheel's 200-unit drawing. */
export const TRACK_R = 88.5
export const POCKET_R = 64

const SLOT = 360 / POCKETS

/** Where the wheel stands at time t. */
export function wheelAngle(t: number): number {
  const turn = ((t % WHEEL_PERIOD_MS) + WHEEL_PERIOD_MS) % WHEEL_PERIOD_MS
  return (turn / WHEEL_PERIOD_MS) * 360
}

/** The middle of a number's pocket, on the wheel. */
export function pocketAngle(n: number): number {
  return WHEEL_ORDER.indexOf(n) * SLOT
}

/** -180 < a <= 180 */
function wrap180(a: number): number {
  const m = (((a + 180) % 360) + 360) % 360
  return m === 0 ? 180 : m - 180
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => x * x * (3 - 2 * x)

/** One spin as this screen shows it. */
export interface SpinPlan {
  spin: number
  /** The ball leaves its pocket: the close, or later when the spin only started showing late. */
  launchAt: number
  /** When it is meant to land: the spin's landsAt. Its decay is tuned to this. */
  landsAt: number
  /** When it does land: landsAt, or later when the number arrived late. */
  landAt: number
  /** The number, once this screen knows it, and when it learned it. */
  number: number | null
  knownAt: number | null
  /** The number the ball rests on before the launch, if known. */
  from: number | null
}

/** When the ball lands, given when the number arrived. */
export function landingTime(landsAt: number, knownAt: number, minimum = MIN_LAND_MS): number {
  return Math.max(landsAt, knownAt + minimum)
}

export interface BallState {
  /** Clockwise from the top of the screen. */
  angle: number
  radius: number
  /** False while there is no ball to show (before the first spin of a season). */
  visible: boolean
  /** True once it rests in the pocket. */
  resting: boolean
}

/** The wheel's angle, unwrapped from the launch on, so the ball's lock onto a pocket has no seam. */
function wheelFrom(plan: SpinPlan, t: number): number {
  return wheelAngle(plan.launchAt) + ((t - plan.launchAt) / WHEEL_PERIOD_MS) * 360
}

function freeAngle(plan: SpinPlan, t: number, start: number): number {
  const seconds = Math.max(1, (plan.landsAt - plan.launchAt) / 1000)
  const k = Math.log(LAUNCH_SPEED / DROP_SPEED) / seconds
  const tau = Math.max(0, (t - plan.launchAt) / 1000)
  // Speed LAUNCH_SPEED * e^(-k tau), counterclockwise.
  return start - (LAUNCH_SPEED / k) * (1 - Math.exp(-k * tau))
}

function startAngle(plan: SpinPlan): number {
  if (plan.from !== null) return wheelAngle(plan.launchAt) + pocketAngle(plan.from)
  // No pocket to leave: a fixed place for this spin, the same on every screen.
  return (plan.spin * 137.5) % 360
}

/** The ball at time t. */
export function ballAt(plan: SpinPlan, t: number): BallState {
  const start = startAngle(plan)
  if (t < plan.launchAt) {
    if (plan.from === null) return { angle: 0, radius: TRACK_R, visible: false, resting: true }
    return {
      angle: wheelAngle(t) + pocketAngle(plan.from),
      radius: POCKET_R,
      visible: true,
      resting: true,
    }
  }

  let angle = freeAngle(plan, t, start)
  const known = plan.number !== null && plan.knownAt !== null
  if (known) {
    const knownAt = Math.max(plan.knownAt as number, plan.launchAt)
    const target = wheelAngle(plan.landAt) + pocketAngle(plan.number as number)
    const delta = wrap180(target - freeAngle(plan, plan.landAt, start))
    const span = Math.max(1, plan.landAt - knownAt)
    const s = clamp01((t - knownAt) / span)
    // Most of the bend while the ball is fast, none of it at the end.
    angle += delta * (1 - (1 - s) ** 3)
    // At the end the ball stops running and rides its pocket.
    const lockOffset = freeAngle(plan, plan.landAt, start) + delta - wheelFrom(plan, plan.landAt)
    const locked = wheelFrom(plan, t) + lockOffset
    if (t >= plan.landAt) {
      return { angle: locked, radius: POCKET_R, visible: true, resting: true }
    }
    const w = smooth(clamp01((t - (plan.landAt - SETTLE_MS)) / SETTLE_MS))
    angle = angle + (locked - angle) * w
  }

  // Out of the pocket at the launch, round the track, then the drop with a few bounces.
  let radius = TRACK_R
  const lifted = clamp01((t - plan.launchAt) / LIFT_MS)
  if (plan.from !== null && lifted < 1) radius = POCKET_R + (TRACK_R - POCKET_R) * smooth(lifted)
  if (known) {
    const dropFrom = Math.max(plan.landAt - DROP_MS, plan.knownAt as number)
    const u = clamp01((t - dropFrom) / Math.max(1, plan.landAt - dropFrom))
    if (u > 0) {
      const fall = POCKET_R + (TRACK_R - POCKET_R) * (1 - smooth(u))
      const bounce = 7 * Math.abs(Math.sin(u * Math.PI * 3)) * (1 - u) ** 1.6
      radius = Math.min(TRACK_R, fall + bounce)
    }
  }
  return { angle, radius, visible: true, resting: false }
}

/** The moments the ball clicks against the frets as it bounces in: for sound. */
export function bounceTimes(plan: SpinPlan): number[] {
  if (plan.number === null || plan.knownAt === null) return []
  const dropFrom = Math.max(plan.landAt - DROP_MS, plan.knownAt)
  const span = plan.landAt - dropFrom
  return [1 / 3, 2 / 3].map((u) => dropFrom + span * u)
}
