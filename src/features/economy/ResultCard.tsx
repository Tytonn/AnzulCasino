/**
 * What a press of work, slut, crime or Collect brought: the amount, the
 * flavor line and when the button is ready again, in a card under the
 * button (spec: Work and crime: "Each shows a short random flavor line with
 * the result"; they "only show a result to the player who pressed the
 * button"). It never blocks anything and goes by itself; the next press
 * replaces it. The economy's overlay draws it once for the whole page.
 */
import { AnimatePresence, motion } from 'motion/react'
import { type CSSProperties, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'

import { formatChips } from '../../../shared/chips.ts'
import { useNow } from '../../kit/clock.ts'
import { CloseIcon, type Icon } from '../../kit/icons.tsx'
import { TABLET } from '../../kit/media.ts'
import { longWait, msUntil } from './data.ts'

export interface Result {
  /** What happened, small above the amount: "Work", "Collected". */
  title: string
  icon: Icon
  /** The color for the icon, such as var(--economy-work). */
  tone: string
  /** Chips, signed: above zero was paid, below zero was a fine. */
  amount: number
  /** The flavor line, if any. */
  line: string | null
  /** Short notes under it, such as a fine that stopped at an empty wallet. */
  notes: readonly string[]
  /** When the button can be pressed again, and its name. */
  readyAt: string | null
  readyLabel: string | null
}

interface Shown extends Result {
  id: number
  /** Where the card sits, in pixels from the viewport's top left. */
  top: number
  left: number
  width: number
}

const CARD_WIDTH = 300
const EDGE = 12
const SHOW_MS = 5_500

const useResult = create<{ shown: Shown | null }>(() => ({ shown: null }))
let nextId = 1

/** Where the card goes: under the button on a wide screen, across the top on a phone. */
function placeCard(anchor: Element | null): Pick<Shown, 'top' | 'left' | 'width'> {
  const viewport = document.documentElement.clientWidth
  const header = document.querySelector('header')?.getBoundingClientRect()
  if (!anchor || !window.matchMedia(TABLET).matches) {
    return {
      top: (header?.bottom ?? 0) + 8,
      left: EDGE,
      width: Math.min(viewport - EDGE * 2, 420),
    }
  }
  const rect = anchor.getBoundingClientRect()
  const width = Math.min(CARD_WIDTH, viewport - EDGE * 2)
  const centered = rect.left + rect.width / 2 - width / 2
  return {
    top: Math.max(rect.bottom, header?.bottom ?? 0) + 8,
    left: Math.min(Math.max(EDGE, centered), viewport - width - EDGE),
    width,
  }
}

/** Shows a result under `anchor` (the button pressed), replacing any card already up. */
export function showResult(result: Result, anchor: Element | null): void {
  useResult.setState({ shown: { ...result, id: nextId++, ...placeCard(anchor) } })
}

export function dismissResult(): void {
  useResult.setState({ shown: null })
}

function ReadyLine({ readyAt, label }: { readyAt: string; label: string }) {
  const now = useNow().getTime()
  const left = msUntil(readyAt, now)
  return (
    <p className="text-xs text-faint">
      {left > 0 ? (
        <>
          {label} again in{' '}
          <span className="font-semibold text-muted tabular-nums">{longWait(left)}</span>
        </>
      ) : (
        <span className="font-semibold text-text">{label} is ready again.</span>
      )}
    </p>
  )
}

function Card({ shown }: { shown: Shown }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const paid = shown.amount > 0
  const fined = shown.amount < 0
  const Glyph = shown.icon

  const arm = (ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (useResult.getState().shown?.id === shown.id) dismissResult()
    }, ms)
  }

  useEffect(() => {
    arm(SHOW_MS)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissResult()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer.current)
      window.removeEventListener('keydown', onKey)
    }
    // A new card is a new component (keyed by id), so this runs once per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <motion.div
      role="status"
      aria-live="polite"
      data-economy-result
      initial={{ opacity: 0, y: -10, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 560, damping: 34 }}
      onPointerEnter={() => clearTimeout(timer.current)}
      onPointerLeave={() => arm(2_000)}
      style={
        {
          top: shown.top,
          left: shown.left,
          width: shown.width,
          '--tone': shown.tone,
        } as CSSProperties
      }
      className={`pointer-events-auto fixed z-40 overflow-hidden rounded-lg border bg-surface-2 shadow-pop ${
        paid ? 'border-gold/45' : fined ? 'border-loss/45' : 'border-border-strong'
      }`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-linear-to-b from-[color-mix(in_oklab,var(--tone)_16%,transparent)] to-transparent"
      />
      <div className="relative flex gap-3 p-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--tone)_18%,var(--surface-3))] text-(--tone)">
          <Glyph className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-semibold tracking-[0.12em] text-faint uppercase">
            {shown.title}
          </p>
          <p
            className={`text-3xl leading-tight font-black tabular-nums ${
              paid ? 'text-gold' : fined ? 'text-loss' : 'text-muted'
            }`}
          >
            {paid ? '+' : fined ? '−' : ''}
            {formatChips(Math.abs(shown.amount))}
          </p>
        </div>
        <button
          type="button"
          onClick={dismissResult}
          aria-label="Close"
          className="-mt-1 -mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-faint hover:bg-surface-3 hover:text-text active:scale-95"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      {(shown.line || shown.notes.length > 0) && (
        <div className="relative space-y-1.5 px-3.5 pb-3">
          {shown.line && <p className="text-sm leading-snug text-text">{shown.line}</p>}
          {shown.notes.map((note) => (
            <p key={note} className="text-xs leading-snug text-muted">
              {note}
            </p>
          ))}
        </div>
      )}
      {shown.readyAt && shown.readyLabel && (
        <div className="relative border-t border-border bg-surface-1/60 px-3.5 py-2">
          <ReadyLine readyAt={shown.readyAt} label={shown.readyLabel} />
        </div>
      )}
    </motion.div>
  )
}

/** Drawn once, by the economy's overlay. */
export function ResultLayer() {
  const shown = useResult((s) => s.shown)
  return createPortal(
    <AnimatePresence>{shown && <Card key={shown.id} shown={shown} />}</AnimatePresence>,
    document.body,
  )
}
