/**
 * The Daily panel, opened from the top bar's Daily button: what is waiting
 * to collect, the streak, today's challenges with their Claim buttons
 * (spec: Challenges: "the player claims the chips with one click"), the
 * next rank, and the latest results of work, slut and crime (spec: "Results
 * show in the activity feed"). A popover under the button on a wide screen,
 * a sheet from the bottom on a phone.
 */
import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'
import { create } from 'zustand'

import { chipCount, formatChips } from '../../../shared/chips.ts'
import {
  type ActivityItem,
  type ChallengeView,
  describeChallenge,
  describeProgress,
  type EconomyState,
  parseChallengeId,
  streakMaxDay,
} from '../../../shared/features/economy.ts'
import { isTier, TIER_LABELS } from '../../../shared/tiers.ts'
import { Button } from '../../kit/Button.tsx'
import { useNow } from '../../kit/clock.ts'
import { ChipIcon, FlameIcon, type Icon } from '../../kit/icons.tsx'
import { TABLET, useMediaQuery } from '../../kit/media.ts'
import { TierBadge } from '../../kit/PlayerName.tsx'
import { useConfig } from '../../kit/queries.ts'
import { Sheet } from '../../kit/Sheet.tsx'
import { gameById } from '../../shell/registry.ts'
import { claimChallenge, collect, COMMAND_ICONS, useBusy } from './actions.ts'
import { ago, incomeNow, longWait, msUntil, perDayText, useEconomy, useHustleName } from './data.ts'
import { DailyIcon, DropIcon, IncomeIcon, TickIcon } from './icons.tsx'
import { shortcutLetter } from './keys.ts'
import { RankLadder, RankRow } from './Ranks.tsx'

// ---------------------------------------------------------------- open and closed

const usePanel = create<{ open: boolean; anchor: DOMRect | null }>(() => ({
  open: false,
  anchor: null,
}))

export function openDailyPanel(from: Element | null): void {
  usePanel.setState({ open: true, anchor: from?.getBoundingClientRect() ?? null })
}

export function closeDailyPanel(): void {
  usePanel.setState({ open: false })
}

export function toggleDailyPanel(from: Element | null): void {
  if (usePanel.getState().open) closeDailyPanel()
  else openDailyPanel(from)
}

export function useDailyPanel() {
  const open = usePanel((s) => s.open)
  return { open, toggle: toggleDailyPanel, close: closeDailyPanel }
}

// ---------------------------------------------------------------- pieces

function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-[0.68rem] font-semibold tracking-[0.12em] text-faint uppercase">
        {children}
      </h3>
      {aside && <span className="text-xs text-faint">{aside}</span>}
    </div>
  )
}

function Chips({ amount, className = '' }: { amount: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${className}`}>
      <ChipIcon className="size-3.5 shrink-0" aria-hidden="true" />
      {formatChips(amount)}
    </span>
  )
}

// ---------------------------------------------------------------- collect and the streak

function CollectCard({ state }: { state: EconomyState }) {
  const queryClient = useQueryClient()
  const busy = useBusy('collect')
  const now = useNow().getTime()
  const waiting = incomeNow(state, now)
  const has = waiting.total > 0

  return (
    <section
      aria-label="Collect"
      className="relative overflow-hidden rounded-lg border border-gold/30 bg-surface-2 p-3.5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-10 size-44 rounded-full bg-gold/10 blur-2xl"
      />
      <div className="relative flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-semibold tracking-[0.12em] text-faint uppercase">
            Waiting for you
          </p>
          <p className="text-3xl leading-tight font-black text-gold tabular-nums">
            +{formatChips(waiting.total)}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            <TierBadge tier={state.income.tier} className="size-3.5" />
            <span>
              {TIER_LABELS[state.income.tier]} rank pays {perDayText(state.income.perDay)}
            </span>
            {waiting.bonus > 0 && (
              <span className="text-(--economy-flame)">
                + {formatChips(waiting.bonus)} streak bonus
              </span>
            )}
          </p>
        </div>
        <Button
          variant="gold"
          size="md"
          disabled={!has || busy}
          onClick={(event) => void collect(queryClient, event.currentTarget)}
          className="min-w-[6.5rem]"
        >
          {busy ? 'Collecting…' : 'Collect'}
        </Button>
      </div>
      <div className="relative mt-3">
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="Income toward its daily cap"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(waiting.fill * 100)}
        >
          <div
            className="h-full rounded-full bg-gold transition-[width] duration-1000 ease-linear"
            style={{ width: `${Math.max(2, waiting.fill * 100)}%` }}
          />
        </div>
        <p className="mt-1.5 flex justify-between gap-3 text-[0.7rem] text-faint">
          <span>Income stops at {state.income.capHours} hours' worth</span>
          <span className="tabular-nums">
            {waiting.fullInMs > 0 ? `Full in ${longWait(waiting.fullInMs)}` : 'Full: collect it'}
          </span>
        </p>
      </div>
    </section>
  )
}

function StreakRow({ state }: { state: EconomyState }) {
  const config = useConfig().data
  const { claimedToday, days, bonus, nextBonus, maxBonus } = state.streak
  const step = typeof config?.streak_step === 'number' ? config.streak_step : 0
  const max = typeof config?.streak_max === 'number' ? config.streak_max : maxBonus
  const maxDay = Math.max(1, streakMaxDay(BigInt(step), BigInt(max)) || 1)
  const pips = Math.min(maxDay, 10)
  const filled = Math.min(pips, claimedToday ? days : Math.max(0, days - 1))
  const running = claimedToday ? days : days - 1

  let words: string
  if (claimedToday) {
    words =
      bonus >= maxBonus
        ? `Today's ${chipCount(bonus)} is paid, the most the bonus gives. Keep collecting daily to hold it.`
        : `Today's ${chipCount(bonus)} is paid. Tomorrow pays ${chipCount(nextBonus)} if you collect again.`
  } else if (running > 0) {
    words = `Collect today to keep it going: ${chipCount(bonus)} now, ${chipCount(nextBonus)} tomorrow.`
  } else {
    words = `Collect today to start a streak: ${chipCount(bonus)} now, more each day you come back.`
  }

  return (
    <section aria-label="Streak">
      <SectionTitle aside={`Up to ${chipCount(maxBonus)} a day`}>Streak</SectionTitle>
      <div className="flex items-center gap-3">
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full ${
            running > 0 ? 'bg-(--economy-flame)/15' : 'bg-surface-2'
          }`}
        >
          <FlameIcon
            className={`size-6 ${running > 0 ? 'text-(--economy-flame)' : 'text-faint'}`}
            aria-hidden="true"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {running > 0 ? `Day ${running}` : 'No streak yet'}
            {!claimedToday && running > 0 && (
              <span className="ml-1.5 text-xs font-medium text-(--economy-flame)">
                · day {days} waits for you
              </span>
            )}
          </p>
          <div className="mt-1.5 flex gap-1" aria-hidden="true">
            {Array.from({ length: pips }, (_, i) => (
              <motion.span
                key={i}
                initial={false}
                animate={{ opacity: i < filled ? 1 : 0.35 }}
                className={`h-1.5 flex-1 rounded-full ${i < filled ? 'bg-(--economy-flame)' : 'bg-surface-3'}`}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{words}</p>
    </section>
  )
}

// ---------------------------------------------------------------- challenges

const LEVELS = { 1: 'Easy', 2: 'Medium', 3: 'Hard' } as const

function Ring({ value, done }: { value: number; done: boolean }) {
  const r = 14
  const c = 2 * Math.PI * r
  return (
    <span className="relative grid size-9 shrink-0 place-items-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3" className="stroke-surface-3" />
        <motion.circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className={done ? 'stroke-gold' : 'stroke-accent'}
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, value))) }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </svg>
      {done && <TickIcon className="relative size-4 text-gold" />}
    </span>
  )
}

function ChallengeRow({ challenge }: { challenge: ChallengeView }) {
  const queryClient = useQueryClient()
  const busy = useBusy(`challenge:${challenge.index}`)
  const game = challenge.game ? gameById(challenge.game)?.name : undefined
  const text = describeChallenge(challenge, game)
  const fraction =
    challenge.metric === 'bestMultiplier'
      ? challenge.progress / challenge.target
      : challenge.progress / Math.max(1, challenge.target)
  const ready = challenge.done && !challenge.claimed

  return (
    <motion.li
      layout
      className={`flex items-center gap-3 rounded-md border p-2.5 transition-colors ${
        ready
          ? 'border-gold/45 bg-gold/8'
          : challenge.claimed
            ? 'border-border bg-surface-1 opacity-75'
            : 'border-border bg-surface-1'
      }`}
      data-challenge={challenge.id}
    >
      <Ring value={fraction} done={challenge.done} />
      <div className="min-w-0 flex-1 leading-tight">
        <p className={`text-sm font-medium ${challenge.claimed ? 'text-muted' : 'text-text'}`}>
          {text}
        </p>
        <p className="mt-0.5 text-xs text-faint">
          {LEVELS[challenge.level]} · {describeProgress(challenge, challenge.progress)}
        </p>
      </div>
      {challenge.claimed ? (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gold">
          <TickIcon className="size-3.5" />+{formatChips(challenge.reward)}
        </span>
      ) : ready ? (
        <Button
          variant="gold"
          size="sm"
          disabled={busy}
          onClick={() => void claimChallenge(queryClient, challenge.index, text)}
        >
          Claim {formatChips(challenge.reward)}
        </Button>
      ) : (
        <Chips amount={challenge.reward} className="text-xs font-semibold text-muted" />
      )}
    </motion.li>
  )
}

function Challenges({ state }: { state: EconomyState }) {
  const now = useNow().getTime()
  const list = state.challenges.list
  return (
    <section aria-label="Challenges">
      <SectionTitle aside={`New in ${longWait(msUntil(state.challenges.resetsAt, now))}`}>
        Challenges
      </SectionTitle>
      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted">
          No challenges today. New ones arrive with the daily reset.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((c) => (
            <ChallengeRow key={`${state.challenges.day}:${c.index}`} challenge={c} />
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-faint">Every settled round counts, in any room.</p>
    </section>
  )
}

// ---------------------------------------------------------------- recent results

interface Look {
  icon: Icon
  tone: string
  label: string
}

function look(item: ActivityItem, hustleName: string): Look {
  switch (item.reason) {
    case 'work':
      return { icon: COMMAND_ICONS.work, tone: 'var(--economy-work)', label: 'Work' }
    case 'hustle_win':
      return { icon: COMMAND_ICONS.hustle, tone: 'var(--economy-hustle)', label: hustleName }
    case 'hustle_fine':
      return {
        icon: COMMAND_ICONS.hustle,
        tone: 'var(--economy-hustle)',
        label: `${hustleName} fine`,
      }
    case 'crime_win':
      return { icon: COMMAND_ICONS.crime, tone: 'var(--economy-crime)', label: 'Crime' }
    case 'crime_fine':
      return { icon: COMMAND_ICONS.crime, tone: 'var(--economy-crime)', label: 'Crime fine' }
    case 'rank_income':
      return { icon: IncomeIcon, tone: 'var(--gold)', label: 'Income' }
    case 'daily_bonus':
      return { icon: FlameIcon, tone: 'var(--economy-flame)', label: 'Streak bonus' }
    case 'challenge':
      return { icon: DailyIcon, tone: 'var(--gold)', label: 'Challenge' }
    case 'chat_drop':
      return { icon: DropIcon, tone: 'var(--economy-drop)', label: 'Chat drop' }
    case 'rank_purchase':
      return { icon: IncomeIcon, tone: 'var(--accent)', label: 'Rank bought' }
  }
}

function detail(item: ActivityItem): string | null {
  if (item.line) return item.line
  if (!item.note) return null
  if (item.reason === 'challenge') {
    const spec = parseChallengeId(item.note)
    if (!spec) return null
    return describeChallenge(
      { ...spec, level: 1 },
      spec.game ? gameById(spec.game)?.name : undefined,
    )
  }
  if (item.reason === 'rank_purchase' || item.reason === 'rank_income') {
    return isTier(item.note.toLowerCase()) ? `${item.note} rank` : item.note
  }
  return item.note
}

function Recent({ state }: { state: EconomyState }) {
  const now = useNow(30_000).getTime()
  const hustleName = useHustleName()
  return (
    <section aria-label="Recent results">
      <SectionTitle>Recent</SectionTitle>
      {state.activity.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted">
          Nothing yet. Press Work in the top bar: it pays every time.
        </p>
      ) : (
        <ul className="divide-y divide-border/70">
          <AnimatePresence initial={false}>
            {state.activity.map((item) => {
              const { icon: Glyph, tone, label } = look(item, hustleName)
              const text = detail(item)
              const up = item.delta > 0
              return (
                <motion.li
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-2.5 py-2"
                >
                  <Glyph className="mt-0.5 size-4 shrink-0" style={{ color: tone }} />
                  <div className="min-w-0 flex-1 leading-snug">
                    <p className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{label}</span>
                      <span
                        className={`shrink-0 font-semibold tabular-nums ${up ? 'text-gold' : 'text-loss'}`}
                      >
                        {up ? '+' : '−'}
                        {formatChips(Math.abs(item.delta))}
                      </span>
                    </p>
                    <p className="flex items-baseline justify-between gap-2 text-xs text-muted">
                      <span className="min-w-0">{text}</span>
                      <time className="shrink-0 text-faint" dateTime={item.at}>
                        {ago(item.at, now)}
                      </time>
                    </p>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------- the panel

function Keys() {
  const hustleName = useHustleName()
  const keys: [string, string][] = [
    ['W', 'Work'],
    [shortcutLetter('hustle', hustleName).toUpperCase(), hustleName],
    ['C', 'Crime'],
    ['I', 'Collect'],
    ['D', 'This panel'],
  ]
  return (
    <p className="hidden flex-wrap gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 text-[0.7rem] text-faint [@media(pointer:fine)]:flex">
      {keys.map(([key, what]) => (
        <span key={key} className="whitespace-nowrap">
          <kbd className="rounded-[5px] border border-border-strong px-1 font-sans font-semibold text-muted">
            Shift {key}
          </kbd>{' '}
          {what}
        </span>
      ))}
    </p>
  )
}

/** The player's rank and the next one up, or every rank on request. */
function RankSection({ state }: { state: EconomyState }) {
  const [all, setAll] = useState(false)
  return (
    <section aria-label="Rank">
      <SectionTitle
        aside={
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((open) => !open)}
            className="font-semibold text-accent hover:text-accent-strong"
          >
            {all ? 'Just mine' : 'All ranks'}
          </button>
        }
      >
        Rank
      </SectionTitle>
      {all ? (
        <div className="rounded-md border border-border bg-surface-1 p-1">
          <RankLadder state={state} />
        </div>
      ) : (
        <RankRow state={state} />
      )}
    </section>
  )
}

function PanelBody({ state }: { state: EconomyState }) {
  return (
    <div className="space-y-5 p-4">
      <CollectCard state={state} />
      <StreakRow state={state} />
      <Challenges state={state} />
      <RankSection state={state} />
      <Recent state={state} />
    </div>
  )
}

function PanelSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-label="Loading">
      <div className="skeleton h-28" />
      <div className="skeleton h-14" />
      <div className="skeleton h-40" />
    </div>
  )
}

const WIDTH = 384

function Popover({ anchor, children }: { anchor: DOMRect | null; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    box.current?.focus()
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') closeDailyPanel()
        return
      }
      const target = event.target as Element | null
      if (box.current?.contains(target)) return
      // The Daily button toggles on its own click.
      if (target?.closest?.('[data-economy="daily"]')) return
      // A result card or toast over the panel is not a click away.
      if (target?.closest?.('[data-economy-result]')) return
      closeDailyPanel()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [])

  const viewport = document.documentElement.clientWidth
  const top = (anchor?.bottom ?? 64) + 8
  const left = Math.min(
    Math.max(12, (anchor?.right ?? viewport - 12) - WIDTH),
    viewport - WIDTH - 12,
  )
  return (
    <motion.div
      ref={box}
      role="dialog"
      aria-label="Daily"
      tabIndex={-1}
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
      style={{ top, left, width: WIDTH, maxHeight: `calc(100dvh - ${top + 16}px)` }}
      className="fixed z-40 flex origin-top flex-col overflow-hidden rounded-lg border border-border-strong bg-surface-1 shadow-pop outline-none"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <DailyIcon className="size-4 text-gold" />
        <h2 className="text-sm font-semibold">Daily</h2>
      </header>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">{children}</div>
      <Keys />
    </motion.div>
  )
}

/** Drawn once, by the economy's overlay. */
export function DailyPanelLayer() {
  const { open, anchor } = usePanel()
  const wide = useMediaQuery(TABLET)
  const { data: state, isPending } = useEconomy()
  const { pathname } = useLocation()

  // Walking into another page closes it, like the shell's own sheets.
  useEffect(() => {
    closeDailyPanel()
  }, [pathname])

  // Nothing to show outside a season.
  useEffect(() => {
    if (!isPending && !state) closeDailyPanel()
  }, [isPending, state])

  const body = isPending ? <PanelSkeleton /> : state ? <PanelBody state={state} /> : null

  if (!wide) {
    return (
      <Sheet open={open} onClose={closeDailyPanel} title="Daily" placement="bottom">
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto pb-6">{body}</div>
      </Sheet>
    )
  }
  return createPortal(
    <AnimatePresence>{open && <Popover anchor={anchor}>{body}</Popover>}</AnimatePresence>,
    document.body,
  )
}
