/**
 * The bet controls every game shares (spec: The room model: "Same bet
 * controls everywhere: amount box, half, double, max, repeat last bet. Enter
 * or Space confirms", and "Bets are typed, not clicked"). The box takes a
 * number or shorthand ("250", "2.5k", "half", "all", "max"), shows what it
 * comes to, and sends the text as typed: the server resolves it again
 * against the locked wallet.
 *
 *   <BetBox game="coinflip" label="Flip" busy={play.busy} onBet={flip}>
 *     <SidePicker />            // the game's own choices sit before the button
 *   </BetBox>
 *
 * After each bet the cursor is back in the box, so the next one is typed and
 * confirmed without the mouse (not on touch screens, where that would open
 * the keyboard). In the box, Enter or Space bets and Escape steps out so the
 * game's own letter keys work. Outside it, Enter or Space bets again and M
 * sets the largest bet. The last bet is remembered for each game.
 */
import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react'

import { checkBetAmount, maxBet, parseBetAmount } from '../../shared/bet-amount.ts'
import { formatChips } from '../../shared/chips.ts'
import type { SeasonState } from '../../shared/seasons.ts'
import { Button } from './Button.tsx'
import { ChipIcon } from './icons.tsx'
import { Kbd, useShortcuts } from './Kbd.tsx'
import { TOUCH, useMediaQuery } from './media.ts'
import { useConfig, useSeason } from './queries.ts'
import { playSound } from './sfx.ts'

const lastKey = (game: string) => `anzul.last-bet.${game}`

function readLast(game: string): string {
  try {
    return localStorage.getItem(lastKey(game)) ?? ''
  } catch {
    return ''
  }
}

function saveLast(game: string, text: string): void {
  try {
    localStorage.setItem(lastKey(game), text)
  } catch {
    // Storage is off (a private window): the box just starts empty next time.
  }
}

/** Why the table takes no bets now, or null when it does (or the season is still loading). */
export function closedReason(season: SeasonState | undefined): string | null {
  if (!season) return null
  const current = season.current
  if (!current) return 'No season is running yet.'
  if (current.phase === 'upcoming') return 'Bets open when the season starts.'
  if (current.phase === 'over') return 'The season is over, so bets are closed.'
  if (!season.wallet) return 'You have no chips this season.'
  return null
}

const KEYWORDS = ['all', 'allin', 'all-in', 'half', 'max']

/** Text the player is probably still typing: the start of a keyword, or a lone point. */
export function stillTyping(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (KEYWORDS.includes(t)) return false
  return t === '.' || KEYWORDS.some((word) => word.startsWith(t))
}

export interface BetBoxProps {
  /** The game's id. The last bet is remembered per game. */
  game: string
  /** The bet button's words, such as "Flip" or "Deal". */
  label: string
  /** Places the bet. Send `text` as it is: the server resolves it. */
  onBet: (text: string) => void
  /** True while a bet is on its way: the button waits, the box stays open for typing. */
  busy?: boolean
  /** True while a round is open, or the game takes no bets now: the box locks. */
  disabled?: boolean
  /** Why the box is locked, under it: "Finish your hand first." */
  disabledNote?: string
  /** The game's own choices, between the box and the button: a side, a number of mines. */
  children?: ReactNode
}

export function BetBox({
  game,
  label,
  onBet,
  busy = false,
  disabled = false,
  disabledNote,
  children,
}: BetBoxProps) {
  const { data: season } = useSeason()
  const { data: config } = useConfig()
  const touch = useMediaQuery(TOUCH)
  const reduced = useReducedMotion()
  const shake = useAnimationControls()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(() => readLast(game))
  const [last, setLast] = useState(() => readLast(game))
  // Errors for half-typed words wait until the player tries to bet.
  const [tried, setTried] = useState(false)

  const ready = season !== undefined && config !== undefined
  const closed = closedReason(season)
  const locked = disabled || closed !== null || !ready
  const balance = BigInt(season?.wallet?.balance ?? 0)
  const limits = config && { minBet: BigInt(config.min_bet), maxBetPct: config.max_bet_pct }
  const typed = text.trim()
  const parsed = typed ? parseBetAmount(typed, balance, limits) : null
  const problem =
    !parsed || !limits
      ? null
      : !parsed.ok
        ? parsed.error
        : checkBetAmount(parsed.amount, balance, limits)
  const showProblem = problem !== null && (tried || !stillTyping(typed))
  // Words, k/m/b and a point all show what they come to: "2.5" bets 2 whole chips.
  const shorthand = parsed?.ok && (parsed.keyword !== null || /[kmb.]/i.test(typed))

  function focusBox(select: boolean) {
    if (touch) return
    const box = input.current
    if (!box || box.disabled) return
    box.focus({ preventScroll: true })
    if (select) box.select()
  }

  function nudge() {
    if (!reduced) void shake.start({ x: [0, -7, 7, -4, 4, 0], transition: { duration: 0.32 } })
    focusBox(false)
  }

  function confirm() {
    if (locked || busy) return
    if (!parsed?.ok || problem) {
      setTried(true)
      nudge()
      return
    }
    setTried(false)
    setLast(typed)
    saveLast(game, typed)
    playSound('chip')
    onBet(typed)
  }

  function setAmount(amount: bigint) {
    setText(formatChips(amount))
    setTried(false)
    focusBox(false)
  }

  const minBet = limits?.minBet ?? 0n
  const top = maxBet(balance, limits)
  const base = parsed?.ok ? parsed.amount : 0n
  const halve = () => setAmount(base > 0n ? (base / 2n > minBet ? base / 2n : minBet) : minBet)
  const double = () => {
    const doubled = base > 0n ? base * 2n : minBet
    setAmount(doubled < top ? doubled : top)
  }
  const toMax = () => {
    setText('max')
    setTried(false)
    focusBox(false)
  }

  useShortcuts({ Enter: confirm, Space: confirm, m: toMax }, { enabled: !locked })

  // After each bet or round, the cursor goes back to the box, unless the
  // player has moved on to something else on the page, such as chat.
  const wasWaiting = useRef(busy || locked)
  useEffect(() => {
    const was = wasWaiting.current
    wasWaiting.current = busy || locked
    if (!was || busy || locked || touch) return
    const box = input.current
    if (!box) return
    const active = document.activeElement
    const room = box.closest('[data-room]') ?? box.closest('[data-bet-box]')
    if (!active || active === document.body || room?.contains(active)) {
      box.focus({ preventScroll: true })
      box.select()
    }
  }, [busy, locked, touch])

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      confirm()
    } else if (event.key === 'Escape') {
      event.currentTarget.blur()
    }
  }

  let note: ReactNode = null
  if (closed) note = <span className="text-muted">{closed}</span>
  else if (disabled && disabledNote) note = <span className="text-muted">{disabledNote}</span>
  else if (showProblem) note = <span className="text-loss">{problem}</span>
  else if (shorthand && parsed?.ok) {
    note = <span className="text-muted tabular-nums">= {formatChips(parsed.amount)} chips</span>
  }
  const offerLast = !locked && last !== '' && typed.toLowerCase() !== last.toLowerCase()

  return (
    <div
      data-bet-box
      className="rounded-lg border border-border bg-surface-1/95 p-2 shadow-card backdrop-blur-md md:p-2.5"
    >
      <div className="flex flex-wrap items-stretch gap-2">
        <motion.div
          animate={shake}
          className={`flex h-12 min-w-0 flex-[1_1_15rem] items-center gap-1 rounded-md border bg-surface-2 pr-1 pl-3 transition-colors focus-within:border-accent ${
            showProblem ? 'border-loss/70' : 'border-border'
          } ${locked ? 'opacity-50' : ''}`}
        >
          <ChipIcon aria-hidden="true" className="size-4 shrink-0 text-gold" />
          <input
            ref={input}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setTried(false)
            }}
            onKeyDown={onKeyDown}
            disabled={locked}
            autoFocus={!touch}
            aria-label="Bet amount"
            aria-invalid={showProblem || undefined}
            aria-describedby={`${game}-bet-note`}
            placeholder={touch ? 'Amount' : '50, 2.5k, half, all'}
            inputMode={touch ? 'numeric' : 'text'}
            enterKeyHint="go"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={32}
            className="h-full min-w-0 flex-1 bg-transparent text-lg font-semibold tabular-nums placeholder:text-sm placeholder:font-normal placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={halve}
            disabled={locked}
            aria-label="Half the bet"
            className="px-2"
          >
            ½
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={double}
            disabled={locked}
            aria-label="Double the bet"
            className="px-2"
          >
            2×
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={toMax}
            disabled={locked}
            aria-label="Largest bet"
            className="px-2"
          >
            Max
            <Kbd className="ml-1">M</Kbd>
          </Button>
        </motion.div>

        {children}

        <Button
          variant="primary"
          size="lg"
          onClick={confirm}
          disabled={locked}
          aria-busy={busy || undefined}
          className={`min-w-28 flex-[1_1_auto] sm:flex-none ${busy ? 'cursor-progress opacity-80' : ''}`}
        >
          {label}
          <Kbd>Enter</Kbd>
        </Button>
      </div>

      <div className="flex min-h-6 items-center justify-between gap-2 px-1 pt-1 text-xs">
        <p id={`${game}-bet-note`} aria-live="polite" className="min-w-0 truncate">
          {note}
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
            Last bet <span className="font-semibold text-text tabular-nums">{last}</span>
          </button>
        )}
      </div>
    </div>
  )
}
