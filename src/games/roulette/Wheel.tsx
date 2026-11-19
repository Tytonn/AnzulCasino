/**
 * The wheel: a European wheel drawn in SVG, its 37 pockets in their real
 * order, and the ball. Each frame works out the wheel's and the ball's
 * angles from the server's clock (ball.ts), so it costs two transforms a
 * frame and every screen shows the same spin. With reduced motion the wheel
 * stands still and the ball simply appears in its pocket when it lands.
 */
import { type RefObject, useEffect, useId, useRef } from 'react'

import { pocketColor, POCKETS, WHEEL_ORDER } from '../../../shared/games/roulette.ts'
import { serverNow } from '../../kit/index.ts'
import { ballAt, POCKET_R, pocketAngle, type SpinPlan, wheelAngle } from './ball.ts'

const C = 100
const SLOT = 360 / POCKETS

const FILL = {
  red: 'var(--roulette-red)',
  black: 'var(--roulette-black)',
  green: 'var(--roulette-green)',
} as const

function polar(r: number, degrees: number) {
  const a = (degrees * Math.PI) / 180
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) }
}

function sector(r0: number, r1: number, from: number, to: number): string {
  const a = polar(r1, from)
  const b = polar(r1, to)
  const c = polar(r0, to)
  const d = polar(r0, from)
  return `M${a.x} ${a.y}A${r1} ${r1} 0 0 1 ${b.x} ${b.y}L${c.x} ${c.y}A${r0} ${r0} 0 0 0 ${d.x} ${d.y}Z`
}

interface Ids {
  cone: string
  metal: string
  ball: string
  rim: string
}

/** The parts that turn with the wheel, drawn once. */
function Rotor({ glow, ids }: { glow: number | null; ids: Ids }) {
  return (
    <>
      {WHEEL_ORDER.map((n, i) => {
        const mid = i * SLOT
        const tone = pocketColor(n)
        const label = polar(76.5, mid)
        return (
          <g key={n}>
            <path d={sector(56, 83, mid - SLOT / 2, mid + SLOT / 2)} fill={FILL[tone]} />
            {glow === n && (
              <path
                d={sector(56, 83, mid - SLOT / 2, mid + SLOT / 2)}
                fill="var(--gold)"
                opacity={0.45}
                className="roulette-pulse"
              />
            )}
            <text
              x={label.x}
              y={label.y}
              transform={`rotate(${mid} ${label.x} ${label.y})`}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={7.2}
              fontWeight={700}
              fill="var(--roulette-digit)"
            >
              {n}
            </text>
          </g>
        )
      })}
      {/* The frets between pockets, and the ring that holds the numbers. */}
      {WHEEL_ORDER.map((_, i) => {
        const edge = i * SLOT + SLOT / 2
        const a = polar(56, edge)
        const b = polar(70.5, edge)
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--roulette-fret)"
            strokeWidth={0.9}
            strokeLinecap="round"
          />
        )
      })}
      <circle cx={C} cy={C} r={70.5} fill="none" stroke="var(--roulette-fret)" strokeWidth={0.7} />
      <circle cx={C} cy={C} r={56} fill={`url(#${ids.cone})`} />
      <circle
        cx={C}
        cy={C}
        r={56}
        fill="none"
        stroke="var(--roulette-metal-dark)"
        strokeWidth={1.2}
      />
      {/* The turret: four arms and a knob. */}
      {[0, 90, 180, 270].map((deg) => {
        const tip = polar(30, deg)
        return (
          <g key={deg}>
            <line
              x1={C}
              y1={C}
              x2={tip.x}
              y2={tip.y}
              stroke="var(--roulette-metal)"
              strokeWidth={3.2}
              strokeLinecap="round"
            />
            <circle cx={tip.x} cy={tip.y} r={3.6} fill={`url(#${ids.metal})`} />
          </g>
        )
      })}
      <circle cx={C} cy={C} r={8.5} fill={`url(#${ids.metal})`} />
      <circle cx={C} cy={C} r={3} fill="var(--roulette-metal-dark)" />
    </>
  )
}

export interface WheelProps {
  /** The spin on show, read every frame. Null: the wheel turns with no ball. */
  plan: RefObject<SpinPlan | null>
  reduced: boolean
  /** The number to light up once the ball rests on it. */
  glow?: number | null
  className?: string
  label?: string
}

export function Wheel({ plan, reduced, glow = null, className = '', label }: WheelProps) {
  const rotor = useRef<SVGGElement>(null)
  const ball = useRef<SVGGElement>(null)
  // Gradient ids are per wheel, since a phone shows two wheels at once during a spin.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const ids: Ids = {
    cone: `${uid}-cone`,
    metal: `${uid}-metal`,
    ball: `${uid}-ball`,
    rim: `${uid}-rim`,
  }

  useEffect(() => {
    let frame = 0
    const draw = () => {
      const t = serverNow()
      const current = plan.current
      const turn = reduced ? 0 : wheelAngle(t)
      rotor.current?.setAttribute('transform', `rotate(${turn} ${C} ${C})`)
      const node = ball.current
      if (node) {
        let state = current ? ballAt(current, t) : null
        if (state && reduced) {
          // Still: the ball shows only resting in its pocket.
          const resting = current?.number !== null && t >= (current?.landAt ?? 0)
          const before = t < (current?.launchAt ?? 0)
          const at = resting ? current?.number : before ? current?.from : null
          state =
            at === null || at === undefined
              ? { ...state, visible: false }
              : { angle: pocketAngle(at), radius: POCKET_R, visible: true, resting: true }
        }
        if (!state?.visible) {
          node.setAttribute('opacity', '0')
        } else {
          const p = polar(state.radius, state.angle)
          node.setAttribute('opacity', '1')
          node.setAttribute('transform', `translate(${p.x} ${p.y})`)
        }
      }
      if (!reduced) frame = requestAnimationFrame(draw)
    }
    draw()
    // With reduced motion, a slow tick is enough to show the ball arriving.
    const timer = reduced ? setInterval(draw, 250) : undefined
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(timer)
    }
  }, [plan, reduced])

  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={label ?? 'The roulette wheel'}
      className={`block select-none ${className}`}
    >
      <defs>
        <radialGradient id={ids.cone} cx="42%" cy="38%" r="70%">
          <stop offset="0%" style={{ stopColor: 'var(--roulette-metal-dark)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--roulette-cone)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--roulette-black-deep)' }} />
        </radialGradient>
        <radialGradient id={ids.metal} cx="35%" cy="30%" r="75%">
          <stop offset="0%" style={{ stopColor: 'var(--roulette-ball)' }} />
          <stop offset="60%" style={{ stopColor: 'var(--roulette-metal)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--roulette-metal-dark)' }} />
        </radialGradient>
        <radialGradient id={ids.ball} cx="35%" cy="30%" r="70%">
          <stop offset="0%" style={{ stopColor: 'var(--roulette-ball)' }} />
          <stop offset="70%" style={{ stopColor: 'var(--roulette-ball)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--roulette-ball-shade)' }} />
        </radialGradient>
        <radialGradient id={ids.rim} cx="50%" cy="50%" r="50%">
          <stop offset="86%" style={{ stopColor: 'var(--roulette-rim)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--roulette-rim-edge)' }} />
        </radialGradient>
      </defs>

      {/* The bowl: rim, then the ball track, fixed. */}
      <circle cx={C} cy={C} r={99} fill={`url(#${ids.rim})`} />
      <circle cx={C} cy={C} r={94} fill="var(--roulette-track)" />
      <circle cx={C} cy={C} r={94} fill="none" stroke="var(--roulette-rim-edge)" strokeWidth={1} />
      <circle
        cx={C}
        cy={C}
        r={84}
        fill="none"
        stroke="var(--roulette-rim-edge)"
        strokeWidth={0.8}
      />

      <g ref={rotor}>
        <Rotor glow={glow} ids={ids} />
      </g>

      <g ref={ball} opacity={0}>
        <circle cx={0.9} cy={1.4} r={4.4} fill="var(--roulette-shadow)" />
        <circle r={4.2} fill={`url(#${ids.ball})`} />
      </g>
    </svg>
  )
}
