/**
 * The felt: every place to bet, drawn from layout.ts, with every player's
 * chips in their own color (spec: "The table shows every player's chips on
 * the felt in their color"). Click or tap a place to put your chip size on
 * it; right-click, or hold a finger on it, to take your chips off. The
 * pointer lights the numbers a place covers.
 *
 * When the ball lands, a marker drops onto the number, winning chips glow
 * with what they won, and the others are swept off.
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { type MouseEvent, type PointerEvent, useId, useRef } from 'react'

import { formatChips, formatChipsShort } from '../../../shared/chips.ts'
import { covers, paysTo, type Spot, spotById, spotReturn } from '../../../shared/games/roulette.ts'
import type { Box, Cell, SpotShape, TableLayout } from './layout.ts'

export interface FeltChip {
  userId: string
  /** The player's color, as a CSS value. */
  color: string
  /** Hundredths. */
  amount: number
  me: boolean
}

export interface FeltProps {
  layout: TableLayout
  /** Every player's chips on the spin the table shows, by spot. */
  chips: ReadonlyMap<string, readonly FeltChip[]>
  /** The winning number, once the ball has landed. */
  number: number | null
  /** Places to light up: the one under the pointer, or what the quick-bet box would bet. */
  preview: readonly string[]
  /** Betting is open, so places take clicks. */
  live: boolean
  /** A picture only, such as a replay: nothing to click. */
  still?: boolean
  onPlace: (spot: string) => void
  onRemove: (spot: string) => void
  /** The place under the pointer (or last tapped), or null. */
  onPoint: (spot: string | null) => void
  className?: string
}

const TONE = {
  red: 'var(--roulette-red)',
  black: 'var(--roulette-black)',
  green: 'var(--roulette-green)',
} as const

/** Hold this long on a place to take your chips off it. */
const HOLD_MS = 450
/** A finger that moves this far is scrolling, not holding. */
const SLOP_PX = 9

function diamond(box: Box): string {
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const across = box.w >= box.h
  const w = across ? Math.min(box.w * 0.5, box.h * 1.5) : box.w * 0.62
  const h = across ? box.h * 0.62 : Math.min(box.h * 0.5, box.w * 1.5)
  return `M${cx} ${cy - h / 2}L${cx + w / 2} ${cy}L${cx} ${cy + h / 2}L${cx - w / 2} ${cy}Z`
}

function CellArt({ cell, wide }: { cell: Cell; wide: boolean }) {
  const { box } = cell
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  if (cell.tone !== 'outside') {
    return (
      <g>
        <rect
          x={box.x + 2}
          y={box.y + 2}
          width={box.w - 4}
          height={box.h - 4}
          rx={4}
          fill={TONE[cell.tone]}
        />
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={wide ? 15 : 14}
          fontWeight={700}
          fill="var(--roulette-digit)"
        >
          {cell.label}
        </text>
      </g>
    )
  }
  if (cell.diamond) {
    return (
      <path
        d={diamond(box)}
        fill={TONE[cell.diamond]}
        stroke="var(--roulette-line)"
        strokeWidth={1}
      />
    )
  }
  return (
    <text
      x={cx}
      y={cy}
      transform={cell.turned ? `rotate(-90 ${cx} ${cy})` : undefined}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={wide ? 13 : 12}
      fontWeight={600}
      letterSpacing={0.3}
      fill="var(--roulette-label)"
    >
      {cell.label}
    </text>
  )
}

/** The table itself: cells and lines. It never changes, so it draws once per shape. */
function Table({ layout, felt }: { layout: TableLayout; felt: string }) {
  const wide = layout.orientation === 'wide'
  return (
    <g>
      <rect
        x={0}
        y={0}
        width={layout.width}
        height={layout.height}
        rx={layout.radius}
        fill={`url(#${felt})`}
      />
      {layout.cells.map((cell) => (
        <CellArt key={cell.id} cell={cell} wide={wide} />
      ))}
      {layout.cells.map((cell) => (
        <rect
          key={cell.id}
          x={cell.box.x}
          y={cell.box.y}
          width={cell.box.w}
          height={cell.box.h}
          fill="none"
          stroke="var(--roulette-line)"
          strokeWidth={1}
        />
      ))}
      <rect
        x={0.5}
        y={0.5}
        width={layout.width - 1}
        height={layout.height - 1}
        rx={layout.radius}
        fill="none"
        stroke="var(--roulette-rim-edge)"
        strokeWidth={1.5}
      />
    </g>
  )
}

/** Where a spot's numbers are, to light them up. Outside bets light their own cell too. */
function coveredBoxes(layout: TableLayout, spots: readonly Spot[]): Box[] {
  const boxes: Box[] = []
  const seen = new Set<number>()
  for (const spot of spots) {
    for (const n of spot.numbers) {
      if (seen.has(n)) continue
      seen.add(n)
      const box = layout.numberBoxes.get(n)
      if (box) boxes.push(box)
    }
    const shape = layout.spots.get(spot.id)
    if (shape?.layer === 'cell' && spot.numbers.length > 1) boxes.push(shape.hit)
  }
  return boxes
}

/** One chip, centered on 0,0: the player's color with a striped edge. */
export function ChipFace({
  r,
  color,
  label,
  ring,
}: {
  r: number
  color: string
  label?: string
  /** A glowing ring: the chip won. */
  ring?: boolean
}) {
  const edge = 2 * Math.PI * r * 0.8
  const size = !label ? 0 : label.length <= 2 ? r * 0.84 : label.length <= 3 ? r * 0.72 : r * 0.58
  return (
    <g>
      <circle cx={0.7} cy={1.3} r={r} fill="var(--roulette-shadow)" />
      <circle r={r} fill={color} />
      <circle
        r={r * 0.8}
        fill="none"
        stroke="var(--roulette-chip-edge)"
        strokeWidth={r * 0.2}
        strokeDasharray={`${edge / 12} ${edge / 12}`}
        opacity={0.9}
      />
      <circle r={r * 0.62} fill={color} stroke="var(--roulette-shadow)" strokeWidth={0.6} />
      {label && (
        <text
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size}
          fontWeight={800}
          fill="var(--roulette-chip-ink)"
        >
          {label}
        </text>
      )}
      {ring && (
        <circle
          r={r + 2.6}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={2}
          className="roulette-pulse"
        />
      )}
    </g>
  )
}

/** What a winning chip of yours won, in a gold pill that rises above it. */
function WinPill({ r, text }: { r: number; text: string }) {
  const w = text.length * 6.6 + 9
  return (
    <motion.g
      initial={{ opacity: 0, y: -r * 0.6 }}
      animate={{ opacity: 1, y: -r - 9 }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 380, damping: 22 }}
    >
      <rect x={-w / 2} y={-8} width={w} height={16} rx={8} fill="var(--gold)" />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={800}
        fill="var(--on-gold)"
      >
        {text}
      </text>
    </motion.g>
  )
}

interface Placed {
  key: string
  x: number
  y: number
  chip: FeltChip
  top: boolean
  spot: Spot
}

/** Every chip with its place: others peek out from under yours, up and to the right. */
function placeChips(layout: TableLayout, chips: FeltProps['chips']): Placed[] {
  const out: Placed[] = []
  for (const [id, stack] of chips) {
    const shape = layout.spots.get(id)
    if (!shape || stack.length === 0) continue
    const spot = spotById(id)
    const ordered = [...stack.filter((c) => !c.me).slice(-3), ...stack.filter((c) => c.me)]
    ordered.forEach((chip, i) => {
      const depth = ordered.length - 1 - i
      out.push({
        key: `${id}:${chip.userId}`,
        x: shape.anchor.x + depth * 3.2,
        y: shape.anchor.y - depth * 3.2,
        chip,
        top: depth === 0,
        spot,
      })
    })
  }
  return out
}

const hitOrders = new WeakMap<TableLayout, SpotShape[]>()

/** Every place to click: numbers and outside bets first, so the combinations sit on top. */
function hitOrder(layout: TableLayout): SpotShape[] {
  let order = hitOrders.get(layout)
  if (!order) {
    order = [...layout.spots.values()].sort((a, b) =>
      a.layer === b.layer ? 0 : a.layer === 'cell' ? -1 : 1,
    )
    hitOrders.set(layout, order)
  }
  return order
}

export function Felt({
  layout,
  chips,
  number,
  preview,
  live,
  still = false,
  onPlace,
  onRemove,
  onPoint,
  className = '',
}: FeltProps) {
  const reduced = useReducedMotion() ?? false
  const felt = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-felt`
  const hold = useRef<{
    spot: string
    x: number
    y: number
    timer: ReturnType<typeof setTimeout>
    fired: boolean
  } | null>(null)
  const pointer = useRef<string>('mouse')
  const pointed = useRef<string | null>(null)

  const spotAt = (target: EventTarget | null): string | null =>
    target instanceof Element
      ? (target.closest('[data-spot]')?.getAttribute('data-spot') ?? null)
      : null

  function point(spot: string | null) {
    if (pointed.current === spot) return
    pointed.current = spot
    onPoint(spot)
  }

  function cancelHold() {
    if (hold.current && !hold.current.fired) clearTimeout(hold.current.timer)
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    pointer.current = event.pointerType
    const spot = spotAt(event.target)
    cancelHold()
    hold.current = null
    if (!spot || event.pointerType === 'mouse') return
    const entry = {
      spot,
      x: event.clientX,
      y: event.clientY,
      fired: false,
      timer: setTimeout(() => {
        entry.fired = true
        point(spot)
        onRemove(spot)
        navigator.vibrate?.(12)
      }, HOLD_MS),
    }
    hold.current = entry
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const h = hold.current
    if (h && !h.fired && Math.hypot(event.clientX - h.x, event.clientY - h.y) > SLOP_PX) {
      clearTimeout(h.timer)
      hold.current = null
    }
    if (event.pointerType === 'mouse') point(spotAt(event.target))
  }

  function onClick(event: MouseEvent<SVGSVGElement>) {
    const spot = spotAt(event.target)
    const h = hold.current
    hold.current = null
    if (h?.fired) return
    if (!spot) return
    point(spot)
    onPlace(spot)
  }

  function onContextMenu(event: MouseEvent<SVGSVGElement>) {
    const spot = spotAt(event.target)
    if (!spot) return
    event.preventDefault()
    // A finger's long press has its own timer; this is the mouse's right button.
    if (pointer.current === 'mouse') onRemove(spot)
  }

  const shown = preview.flatMap((id) => {
    try {
      return [spotById(id)]
    } catch {
      return []
    }
  })
  const lit = coveredBoxes(layout, shown)
  const winBox = number === null ? null : layout.numberBoxes.get(number)
  const placed = placeChips(layout, chips)
  const ghosts = shown.flatMap((spot) => {
    const shape = layout.spots.get(spot.id)
    return shape?.layer === 'combo' ? [shape.anchor] : []
  })

  return (
    <svg
      viewBox={`-2 -2 ${layout.width + 4} ${layout.height + 4}`}
      role={still ? 'img' : 'group'}
      aria-label={still ? 'The chips on the table' : 'The betting table'}
      className={`block h-auto w-full touch-manipulation select-none [-webkit-touch-callout:none] ${
        live ? '' : 'cursor-default'
      } ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={() => {
        cancelHold()
        if (pointer.current === 'mouse') point(null)
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <defs>
        <radialGradient id={felt} cx="50%" cy="40%" r="75%">
          <stop offset="0%" style={{ stopColor: 'var(--roulette-felt-glow)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--roulette-felt)' }} />
        </radialGradient>
      </defs>

      <Table layout={layout} felt={felt} />

      {/* What the pointer or the quick-bet box is on. */}
      <g pointerEvents="none">
        {lit.map((box, i) => (
          <rect
            key={i}
            x={box.x + 1}
            y={box.y + 1}
            width={box.w - 2}
            height={box.h - 2}
            rx={4}
            fill="var(--roulette-hover)"
          />
        ))}
        {ghosts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={layout.chipR * 0.8}
            fill="none"
            stroke="var(--roulette-marker)"
            strokeWidth={1.4}
            strokeDasharray="3 2.4"
            opacity={0.85}
          />
        ))}
      </g>

      {/* The winning number, and every outside bet that won with it. */}
      {number !== null && (
        <g pointerEvents="none">
          {layout.cells
            .filter((c) => c.tone === 'outside' && covers(spotById(c.id), number))
            .map((c) => (
              <rect
                key={c.id}
                x={c.box.x + 1.5}
                y={c.box.y + 1.5}
                width={c.box.w - 3}
                height={c.box.h - 3}
                rx={4}
                fill="none"
                stroke="var(--gold)"
                strokeOpacity={0.55}
                strokeWidth={1.5}
              />
            ))}
          {winBox && (
            <rect
              x={winBox.x + 1}
              y={winBox.y + 1}
              width={winBox.w - 2}
              height={winBox.h - 2}
              rx={5}
              fill="none"
              stroke="var(--gold)"
              strokeWidth={2.6}
              className="roulette-pulse"
            />
          )}
        </g>
      )}

      {/* Chips. */}
      <g pointerEvents="none">
        <AnimatePresence>
          {placed.map((p) => {
            const won = number !== null && covers(p.spot, number)
            const lost = number !== null && !won
            const label = p.top ? formatChipsShort(p.chip.amount) : undefined
            const net = won
              ? spotReturn(p.spot, BigInt(p.chip.amount), number) - BigInt(p.chip.amount)
              : 0n
            return (
              <motion.g
                key={p.key}
                style={{ x: p.x, y: p.y }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.6 }}
                animate={
                  lost
                    ? // The house sweeps the losing chips off the felt.
                      {
                        opacity: 0,
                        scale: reduced ? 1 : 0.6,
                        y: reduced ? p.y : p.y - layout.chipR * 2.5,
                        transition: { delay: 0.7, duration: 0.5, ease: 'easeIn' },
                      }
                    : { opacity: 1, scale: 1, y: p.y }
                }
                exit={{ opacity: 0, scale: reduced ? 1 : 0.7, transition: { duration: 0.25 } }}
                transition={{ type: 'spring', stiffness: 700, damping: 30 }}
              >
                <ChipFace r={layout.chipR} color={p.chip.color} label={label} ring={won} />
                {won && p.chip.me && <WinPill r={layout.chipR} text={`+${formatChips(net)}`} />}
              </motion.g>
            )
          })}
        </AnimatePresence>
      </g>

      {/* The marker on the winning number, in its corner so the number still shows. */}
      <AnimatePresence>
        {winBox && number !== null && (
          <g
            key={number}
            pointerEvents="none"
            transform={`translate(${winBox.x + winBox.w - layout.chipR * 0.5 - 3} ${
              winBox.y + layout.chipR * 0.5 + 3
            })`}
          >
            <motion.g
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 2.6, y: -18 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 17 }}
            >
              <circle cx={0.6} cy={1.2} r={layout.chipR * 0.5} fill="var(--roulette-shadow)" />
              <circle
                r={layout.chipR * 0.5}
                fill="var(--roulette-marker)"
                stroke="var(--gold)"
                strokeWidth={1.6}
              />
            </motion.g>
          </g>
        )}
      </AnimatePresence>

      {/* Where clicks land: numbers and outside bets, then the combinations on top. */}
      {!still && (
        <g className={live ? 'cursor-pointer' : ''}>
          {hitOrder(layout).map((shape) => {
            const spot = spotById(shape.id)
            return (
              <rect
                key={shape.id}
                data-spot={shape.id}
                role="button"
                aria-label={`${spot.name}, pays ${paysTo(spot)} to 1`}
                x={shape.hit.x}
                y={shape.hit.y}
                width={shape.hit.w}
                height={shape.hit.h}
                fill="transparent"
              />
            )
          })}
        </g>
      )}
    </svg>
  )
}
