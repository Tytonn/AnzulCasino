/**
 * The Floor card's art: a small wheel turning slowly, with the ball resting
 * in a pocket. Plain SVG and a CSS spin, so it costs nothing on the Floor.
 */
import { pocketColor, POCKETS, WHEEL_ORDER } from '../../../shared/games/roulette.ts'

const C = 50
const SLOT = 360 / POCKETS
const FILL = {
  red: 'var(--roulette-red)',
  black: 'var(--roulette-black)',
  green: 'var(--roulette-green)',
} as const

function at(r: number, degrees: number) {
  const a = (degrees * Math.PI) / 180
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) }
}

function sector(r0: number, r1: number, from: number, to: number): string {
  const a = at(r1, from)
  const b = at(r1, to)
  const c = at(r0, to)
  const d = at(r0, from)
  return `M${a.x} ${a.y}A${r1} ${r1} 0 0 1 ${b.x} ${b.y}L${c.x} ${c.y}A${r0} ${r0} 0 0 0 ${d.x} ${d.y}Z`
}

export function CardArt() {
  const ball = at(30.5, 6 * SLOT)
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="size-24 drop-shadow-lg transition-transform duration-250 group-hover:scale-105 md:size-28"
    >
      <circle cx={C} cy={C} r={49} fill="var(--roulette-rim)" stroke="var(--roulette-rim-edge)" />
      <circle cx={C} cy={C} r={44} fill="var(--roulette-track)" />
      <g className="roulette-idle">
        {WHEEL_ORDER.map((n, i) => (
          <path
            key={n}
            d={sector(26, 41, i * SLOT - SLOT / 2, i * SLOT + SLOT / 2)}
            fill={FILL[pocketColor(n)]}
            stroke="var(--roulette-fret)"
            strokeWidth={0.25}
          />
        ))}
        <circle cx={C} cy={C} r={26} fill="var(--roulette-cone)" />
        {[0, 90, 180, 270].map((deg) => {
          const tip = at(15, deg)
          return (
            <line
              key={deg}
              x1={C}
              y1={C}
              x2={tip.x}
              y2={tip.y}
              stroke="var(--roulette-metal)"
              strokeWidth={2}
              strokeLinecap="round"
            />
          )
        })}
        <circle cx={C} cy={C} r={4.5} fill="var(--roulette-metal)" />
        <circle cx={ball.x} cy={ball.y} r={2.6} fill="var(--roulette-ball)" />
      </g>
    </svg>
  )
}
