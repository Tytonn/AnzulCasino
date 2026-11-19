/**
 * Roulette's bet controls, at the bottom of the room within thumb reach:
 *
 * - The quick-bet box (spec: Quick-bet box): "<amount> <space>" such as
 *   "200 odd", "600 2nd", "50 17" or "all red", several at once split by
 *   commas. As you type, the felt lights the places and the line under the
 *   box says what the bet comes to. A lone place ("red") bets your chip
 *   size there; a lone amount ("75") makes it your chip size. Enter places
 *   it, and after each spin the cursor is back in the box.
 * - The chip rack: the size each click on the felt puts down.
 * - Undo (U), Clear (C), Repeat last spin's bets (R) and Double (D).
 */
import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { type BetLimits, checkBetAmount, parseBetAmount } from '../../../shared/bet-amount.ts'
import { formatChips, formatChipsShort } from '../../../shared/chips.ts'
import { parseQuickBet, paysTo, spotById } from '../../../shared/games/roulette.ts'
import { Button, Kbd, playSound, TOUCH, useMediaQuery, useShortcuts } from '../../kit/index.ts'
import { ChipIcon } from '../../kit/icons.tsx'
import { amountText } from './chips.ts'
import { ChipFace } from './Felt.tsx'
import { ClearIcon, DoubleIcon, RepeatIcon, UndoIcon } from './icons.tsx'
import type { Bets, PlaceResult } from './useBets.ts'

const TYPED_KEY = 'anzul.roulette.typed'

function readTyped(): string {
  try {
    return localStorage.getItem(TYPED_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveTyped(text: string): void {
  try {
    localStorage.setItem(TYPED_KEY, text)
  } catch {
    // Storage is off: the box just starts empty next time.
  }
}

type Reading =
  | { kind: 'empty' }
  | { kind: 'chip'; amount: bigint }
  | { kind: 'bets'; bets: { spot: string; text: string }[]; summary: string }
  /** `typing`: it does not read as a bet yet, so the error waits until Enter. */
  | { kind: 'error'; error: string; typing: boolean }

/** What the box's text would do, worked out against what you have, as the server will. */
function read(text: string, chip: bigint, available: bigint, limits: BetLimits | null): Reading {
  const typed = text.trim()
  if (!typed) return { kind: 'empty' }
  const parsed = parseQuickBet(typed)
  if (!parsed.ok) return { kind: 'error', error: parsed.error, typing: true }
  if ('amount' in parsed) {
    const amount = parseBetAmount(parsed.amount, available, limits ?? undefined)
    if (!amount.ok) return { kind: 'error', error: amount.error, typing: true }
    if (limits && amount.amount < limits.minBet) {
      return {
        kind: 'error',
        error: `The smallest chip is ${formatChips(limits.minBet)}.`,
        typing: false,
      }
    }
    return { kind: 'chip', amount: amount.amount }
  }
  const bets = parsed.bets.map((b) => ({ spot: b.spot, text: b.amount ?? amountText(chip) }))
  let left = available
  const parts: string[] = []
  for (const bet of bets) {
    const amount = parseBetAmount(bet.text, left, limits ?? undefined)
    if (!amount.ok) return { kind: 'error', error: amount.error, typing: true }
    const problem = limits ? checkBetAmount(amount.amount, left, limits) : null
    const spot = spotById(bet.spot)
    if (problem) {
      const error = bets.length > 1 ? `${spot.name}: ${problem}` : problem
      return { kind: 'error', error, typing: false }
    }
    left -= amount.amount
    parts.push(`${formatChips(amount.amount)} on ${spot.name}`)
  }
  const one = bets.length === 1 ? spotById((bets[0] as { spot: string }).spot) : null
  const summary = one ? `${parts[0]}, pays ${paysTo(one)} to 1` : parts.join(' · ')
  return { kind: 'bets', bets, summary }
}

export interface ControlsProps {
  bets: Bets
  /** A spin is taking bets now. */
  open: boolean
  /** Why no bet can go down at all (no season, no chips), or null. */
  shut: string | null
  limits: BetLimits | null
  chip: bigint
  rack: readonly bigint[]
  /** Your chips' color. */
  color: string
  onChip: (amount: bigint) => void
  /** The places the box would bet on, for the felt to light up. */
  onPreview: (spots: string[]) => void
  /** Says why a move did not go through. */
  say: (message: string) => void
  /** The spin's countdown and result, along the top of the panel. */
  status: ReactNode
}

export function Controls({
  bets,
  open,
  shut,
  limits,
  chip,
  rack,
  color,
  onChip,
  onPreview,
  say,
  status,
}: ControlsProps) {
  const touch = useMediaQuery(TOUCH)
  const reduced = useReducedMotion()
  const shake = useAnimationControls()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [last, setLast] = useState(readTyped)
  const [tried, setTried] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const locked = shut !== null
  const reading = read(text, chip, bets.available, limits)
  const spots = reading.kind === 'bets' ? reading.bets.map((b) => b.spot) : []
  const preview = spots.join(',')
  useEffect(() => {
    onPreview(preview ? preview.split(',') : [])
  }, [preview, onPreview])

  function focusBox(select: boolean) {
    if (touch) return
    const box = input.current
    if (!box || box.disabled) return
    box.focus({ preventScroll: true })
    if (select) box.select()
  }

  function nudge() {
    if (!reduced) void shake.start({ x: [0, -7, 7, -4, 4, 0], transition: { duration: 0.32 } })
  }

  function after(result: PlaceResult) {
    if (result.ok) {
      playSound('chip')
      setNote(null)
    } else {
      say(result.error)
    }
  }

  function confirm() {
    if (locked) return
    if (reading.kind === 'empty') {
      focusBox(false)
      return
    }
    if (reading.kind === 'error') {
      setTried(true)
      nudge()
      focusBox(false)
      return
    }
    setTried(false)
    if (reading.kind === 'chip') {
      onChip(reading.amount)
      setText('')
      setNote(`Each click now bets ${formatChips(reading.amount)}.`)
      focusBox(false)
      return
    }
    const result = bets.place(reading.bets)
    if (!result.ok) {
      setNote(null)
      say(result.error)
      nudge()
      return
    }
    playSound('chip')
    const typed = text.trim()
    setLast(typed)
    saveTyped(typed)
    setNote(null)
    focusBox(true)
  }

  // After each spin, the cursor is back in the box (spec: Bets are typed, not clicked).
  const wasOpen = useRef(open)
  useEffect(() => {
    const was = wasOpen.current
    wasOpen.current = open
    if (was || !open || touch) return
    const box = input.current
    const active = document.activeElement
    const room = box?.closest('[data-room]')
    if (box && (!active || active === document.body || room?.contains(active))) {
      box.focus({ preventScroll: true })
      box.select()
    }
  }, [open, touch])

  const canBet = open && !locked
  useShortcuts(
    {
      Enter: confirm,
      Space: confirm,
      u: () => after(bets.undo()),
      Backspace: () => after(bets.undo()),
      c: () => after(bets.clear()),
      r: () => after(bets.repeat()),
      d: () => after(bets.double()),
    },
    { enabled: canBet },
  )

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      confirm()
    } else if (event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }

  let line: ReactNode = null
  if (shut) line = <span className="text-muted">{shut}</span>
  else if (reading.kind === 'error' && tried)
    line = <span className="text-loss">{reading.error}</span>
  else if (reading.kind === 'error' && !reading.typing) {
    line = <span className="text-muted">{reading.error}</span>
  } else if (reading.kind === 'bets') {
    line = <span className="text-muted tabular-nums">= {reading.summary}</span>
  } else if (reading.kind === 'chip') {
    line = (
      <span className="text-muted tabular-nums">
        Enter makes {formatChips(reading.amount)} your chip size
      </span>
    )
  } else if (note) line = <span className="text-muted">{note}</span>
  else if (reading.kind === 'error') {
    line = <span className="text-faint">Type an amount and a place, like 50 red</span>
  }
  const offerLast = canBet && last !== '' && text.trim().toLowerCase() !== last.toLowerCase()
  const custom = !rack.includes(chip)
  const hasBets = bets.current.length > 0

  return (
    <div
      data-bet-box
      className="overflow-hidden rounded-lg border border-border bg-surface-1/95 shadow-card backdrop-blur-md"
    >
      {status}
      <div className="flex flex-col gap-2 p-2 md:p-2.5">
        <div className="flex items-stretch gap-2">
          <motion.div
            animate={shake}
            className={`flex h-12 min-w-0 flex-1 items-center gap-2 rounded-md border bg-surface-2 pr-1 pl-3 transition-colors focus-within:border-accent ${
              reading.kind === 'error' && tried ? 'border-loss/70' : 'border-border'
            } ${locked ? 'opacity-50' : ''}`}
          >
            <ChipIcon aria-hidden="true" className="size-4 shrink-0 text-gold" />
            <input
              ref={input}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setTried(false)
                setNote(null)
              }}
              onKeyDown={onKeyDown}
              disabled={locked}
              autoFocus={!touch}
              aria-label="Quick bet: an amount and a place, like 50 red"
              aria-invalid={(reading.kind === 'error' && tried) || undefined}
              aria-describedby="roulette-bet-note"
              placeholder={touch ? '50 red, all 17' : '50 red · all 17 · 25 2nd · 10 0'}
              enterKeyHint="go"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={160}
              className="h-full min-w-0 flex-1 bg-transparent text-lg font-semibold placeholder:text-sm placeholder:font-normal placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
            />
          </motion.div>
          <Button
            variant="primary"
            size="lg"
            onClick={confirm}
            disabled={locked || !open}
            className="min-w-24 px-5"
          >
            Bet
            <span className="max-md:hidden">
              <Kbd>Enter</Kbd>
            </span>
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div role="radiogroup" aria-label="Chip size" className="flex items-center gap-1">
            {[...rack, ...(custom ? [chip] : [])].map((value) => {
              const selected = value === chip
              return (
                <button
                  key={value.toString()}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={`Chip size ${formatChips(value)}`}
                  onClick={() => {
                    onChip(value)
                    setNote(null)
                  }}
                  className={`grid size-9 shrink-0 place-items-center rounded-full transition duration-150 active:scale-90 sm:size-10 ${
                    selected
                      ? '-translate-y-0.5 outline-2 outline-offset-1 outline-gold'
                      : 'opacity-70 hover:-translate-y-0.5 hover:opacity-100'
                  }`}
                >
                  <svg viewBox="-13.5 -13.5 27 27" className="size-full" aria-hidden="true">
                    <ChipFace r={12.5} color={color} label={formatChipsShort(value)} />
                  </svg>
                </button>
              )
            })}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => after(bets.undo())}
              disabled={!canBet || !bets.canUndo}
              aria-label="Undo"
              title="Undo (U)"
              className="h-9 px-2"
            >
              <UndoIcon className="size-4.5" />
              <span className="max-lg:hidden">Undo</span>
              <span className="max-lg:hidden">
                <Kbd>U</Kbd>
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => after(bets.clear())}
              disabled={!canBet || !hasBets}
              aria-label="Clear your bets"
              title="Clear (C)"
              className="h-9 px-2"
            >
              <ClearIcon className="size-4.5" />
              <span className="max-lg:hidden">Clear</span>
              <span className="max-lg:hidden">
                <Kbd>C</Kbd>
              </span>
            </Button>
            {hasBets ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => after(bets.double())}
                disabled={!canBet}
                aria-label="Double your bets"
                title="Double (D)"
                className="h-9 px-2"
              >
                <DoubleIcon className="size-4.5" />
                <span className="max-lg:hidden">Double</span>
                <span className="max-lg:hidden">
                  <Kbd>D</Kbd>
                </span>
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => after(bets.repeat())}
                disabled={!canBet || bets.last.length === 0}
                aria-label="Repeat your last bets"
                title="Repeat last spin's bets (R)"
                className="h-9 px-2"
              >
                <RepeatIcon className="size-4.5" />
                <span className="max-lg:hidden">Repeat</span>
                <span className="max-lg:hidden">
                  <Kbd>R</Kbd>
                </span>
              </Button>
            )}
          </div>
        </div>

        <div className="flex min-h-5 items-center justify-between gap-2 px-1 text-xs">
          <p id="roulette-bet-note" aria-live="polite" className="min-w-0 truncate">
            {line}
          </p>
          {offerLast && (
            <button
              type="button"
              onClick={() => {
                setText(last)
                setTried(false)
                focusBox(false)
              }}
              className="shrink-0 rounded-full border border-border px-2 py-0.5 text-muted transition hover:border-border-strong hover:text-text active:scale-95"
            >
              Last bet <span className="font-semibold text-text">{last}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
