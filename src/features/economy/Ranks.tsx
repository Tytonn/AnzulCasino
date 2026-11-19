/**
 * Ranks (spec: Economy > Ranks; "Tier" in code): the card on the Shop page
 * with every rank, its price, its income and a countdown to the next unlock,
 * and the next-rank row in the Daily panel. A player buys only the next rank
 * up, at most one a game day, never on the final day. Buying asks twice,
 * since the price leaves the game.
 */
import { useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import type { EconomyState, TierStepView } from '../../../shared/features/economy.ts'
import { type Tier, TIER_LABELS, TIERS } from '../../../shared/tiers.ts'
import { Button } from '../../kit/Button.tsx'
import { useNow } from '../../kit/clock.ts'
import { TierBadge, tierColor } from '../../kit/PlayerName.tsx'
import { useWallet } from '../../kit/queries.ts'
import { buyRank, useBusy } from './actions.ts'
import { longWait, msUntil, perDayText, useEconomy } from './data.ts'
import { LockIcon, TickIcon } from './icons.tsx'

// ---------------------------------------------------------------- where the next rank stands

export type NextRank =
  | { kind: 'top' }
  | { kind: 'closed' }
  | { kind: 'never'; step: TierStepView }
  | { kind: 'locked'; step: TierStepView; inMs: number }
  | { kind: 'tomorrow'; step: TierStepView; inMs: number }
  | { kind: 'short'; step: TierStepView; need: number }
  | { kind: 'ready'; step: TierStepView }

/** The next rank and what stands in its way, in the order the server checks. */
export function nextRank(state: EconomyState, balance: number, now: number): NextRank {
  const step = state.ranks.next
  if (now >= Date.parse(state.ranks.closesAt)) return { kind: 'closed' }
  if (!step) return { kind: 'top' }
  if (Date.parse(step.unlocksAt) >= Date.parse(state.ranks.closesAt)) return { kind: 'never', step }
  const opensIn = msUntil(step.unlocksAt, now)
  if (opensIn > 0) return { kind: 'locked', step, inMs: opensIn }
  if (state.ranks.boughtToday) {
    return { kind: 'tomorrow', step, inMs: msUntil(state.challenges.resetsAt, now) }
  }
  if (balance < step.price) return { kind: 'short', step, need: step.price - balance }
  return { kind: 'ready', step }
}

/** The next unlock this season for anyone, for the Shop's countdown. */
function nextUnlock(state: EconomyState, now: number): TierStepView | null {
  const closes = Date.parse(state.ranks.closesAt)
  return (
    state.ranks.ladder.find((s) => {
      const at = Date.parse(s.unlocksAt)
      return s.tier !== 'base' && at > now && at < closes
    }) ?? null
  )
}

// ---------------------------------------------------------------- buying, asked twice

const CONFIRM_MS = 3_500

export function BuyRankButton({
  step,
  size = 'sm',
  className = '',
}: {
  step: TierStepView
  size?: 'sm' | 'md'
  className?: string
}) {
  const queryClient = useQueryClient()
  const busy = useBusy('tier')
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (!asking) return
    const timer = setTimeout(() => setAsking(false), CONFIRM_MS)
    return () => clearTimeout(timer)
  }, [asking])

  const label = TIER_LABELS[step.tier]
  return (
    <Button
      variant={asking ? 'gold' : 'primary'}
      size={size}
      disabled={busy}
      aria-live="polite"
      className={`min-w-[6.5rem] ${className}`}
      onClick={() => {
        if (!asking) {
          setAsking(true)
          return
        }
        setAsking(false)
        void buyRank(queryClient, step.tier)
      }}
    >
      {busy ? 'Buying…' : asking ? `Pay ${formatChips(step.price)}?` : `Buy ${label}`}
    </Button>
  )
}

/** What stands in the way, in a few words. */
function waitWords(next: NextRank): string {
  switch (next.kind) {
    case 'top':
      return 'You hold the top rank.'
    case 'closed':
      return 'Rank purchases are off on the final day.'
    case 'never':
      return `${TIER_LABELS[next.step.tier]} does not open before the final day this season.`
    case 'locked':
      return `Opens in ${longWait(next.inMs)}`
    case 'tomorrow':
      return `One rank a day. Buy it in ${longWait(next.inMs)}.`
    case 'short':
      return `You need ${formatChips(next.need)} more in your wallet.`
    case 'ready':
      return 'Ready to buy.'
  }
}

// ---------------------------------------------------------------- the Daily panel's row

/** The player's rank and the next one up, with its button or what it waits for. */
export function RankRow({ state }: { state: EconomyState }) {
  const now = useNow().getTime()
  const balance = useWallet()?.balance ?? 0
  const next = nextRank(state, balance, now)
  const mine = state.income.tier
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-sm">
        <TierBadge tier={mine} className="size-5" />
        <span className="font-semibold" style={{ color: tierColor(mine) }}>
          {TIER_LABELS[mine]}
        </span>
        <span className="text-muted">· {perDayText(state.income.perDay)}</span>
      </div>
      {'step' in next && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-surface-1 p-2.5">
          <TierBadge tier={next.step.tier} className="size-7" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-sm">
              <span className="font-semibold" style={{ color: tierColor(next.step.tier) }}>
                {TIER_LABELS[next.step.tier]}
              </span>{' '}
              <span className="text-muted">for {formatChips(next.step.price)}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {perDayText(next.step.perDay)} in income
              {next.kind !== 'ready' && <> · {waitWords(next)}</>}
            </p>
          </div>
          {next.kind === 'ready' ? (
            <BuyRankButton step={next.step} />
          ) : (
            <LockIcon className="size-4 shrink-0 text-faint" />
          )}
        </div>
      )}
      {!('step' in next) && <p className="text-xs text-muted">{waitWords(next)}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- the Shop card

function LadderRow({
  step,
  mine,
  next,
  now,
}: {
  step: TierStepView
  mine: Tier
  next: NextRank
  now: number
}) {
  const level = TIERS.indexOf(step.tier)
  const mineLevel = TIERS.indexOf(mine)
  const isMine = step.tier === mine
  const passed = level < mineLevel
  const isNext = 'step' in next && next.step.tier === step.tier
  const opensIn = msUntil(step.unlocksAt, now)

  let status: ReactNode
  if (isMine) {
    status = (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-semibold text-accent-strong">
        Yours
      </span>
    )
  } else if (passed) {
    status = <TickIcon className="size-4 text-faint" aria-label="Passed" />
  } else if (isNext && next.kind === 'ready') {
    status = <BuyRankButton step={step} />
  } else if (isNext) {
    status = <span className="text-right text-xs leading-snug text-muted">{waitWords(next)}</span>
  } else if (opensIn > 0) {
    status = (
      <span className="inline-flex items-center gap-1 text-xs text-faint">
        <LockIcon className="size-3.5" />
        Day {step.unlockDay}
      </span>
    )
  } else {
    status = (
      <span className="text-xs text-faint">After {TIER_LABELS[TIERS[level - 1] ?? 'base']}</span>
    )
  }

  return (
    <li
      className={`flex items-center gap-3 rounded-md px-2.5 py-2 ${
        isMine ? 'bg-accent/10 shadow-[inset_2px_0_0_var(--accent)]' : isNext ? 'bg-surface-2' : ''
      }`}
      aria-current={isMine ? 'true' : undefined}
    >
      <span className="grid size-7 shrink-0 place-items-center">
        {step.tier === 'base' ? (
          <span className="size-2 rounded-full bg-border-strong" />
        ) : (
          <TierBadge tier={step.tier} className="size-6" />
        )}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p
          className={`text-sm font-semibold ${passed ? 'opacity-60' : ''}`}
          style={{ color: tierColor(step.tier) }}
        >
          {TIER_LABELS[step.tier]}
        </p>
        <p className="mt-0.5 text-xs text-muted tabular-nums">
          {step.price > 0 ? formatChips(step.price) : 'Free'} · {perDayText(step.perDay)}
        </p>
      </div>
      <div className="flex max-w-[52%] min-w-0 items-center justify-end">{status}</div>
    </li>
  )
}

/**
 * Every rank, base first: its price, its income and where the player stands.
 * With `columns`, from 640px up it reads down two columns, Base to Gold and
 * then the rest, as the Shop's wide card does.
 */
export function RankLadder({ state, columns = false }: { state: EconomyState; columns?: boolean }) {
  const now = useNow().getTime()
  const balance = useWallet()?.balance ?? 0
  const next = nextRank(state, balance, now)
  const rows = Math.ceil(state.ranks.ladder.length / 2)
  return (
    <ol
      className={
        columns
          ? 'grid gap-0.5 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-(--ladder-rows) sm:gap-x-2'
          : 'space-y-0.5'
      }
      style={columns ? ({ '--ladder-rows': `repeat(${rows}, auto)` } as CSSProperties) : undefined}
    >
      {state.ranks.ladder.map((step) => (
        <LadderRow key={step.tier} step={step} mine={state.income.tier} next={next} now={now} />
      ))}
    </ol>
  )
}

/**
 * The Shop's rank card (the `shop-items` slot). It takes the grid's whole
 * width, so the seven ranks sit in two short columns instead of one tall
 * card that stretches every item beside it.
 */
export function RankCard() {
  const { data: state, isPending } = useEconomy()
  const now = useNow().getTime()

  if (isPending) {
    return (
      <div
        className="skeleton h-96 w-full rounded-lg sm:col-span-full sm:h-72"
        aria-label="Loading ranks"
      />
    )
  }
  if (!state) return null

  const unlock = nextUnlock(state, now)
  const unlockIn = unlock ? msUntil(unlock.unlocksAt, now) : 0

  return (
    <section
      aria-labelledby="economy-ranks"
      className="w-full overflow-hidden rounded-lg border border-border bg-surface-1 shadow-card sm:col-span-full"
      data-economy="ranks"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
        <div>
          <h2 id="economy-ranks" className="text-base font-semibold">
            Ranks
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            A rank pays income every day, and gives your name its color and badge.
          </p>
        </div>
        {unlock ? (
          <motion.div
            key={unlock.tier}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-right"
          >
            <p className="text-[0.65rem] tracking-[0.1em] text-faint uppercase">
              <span style={{ color: tierColor(unlock.tier) }}>{TIER_LABELS[unlock.tier]}</span>{' '}
              opens in
            </p>
            <p className="text-sm font-semibold tabular-nums">{longWait(unlockIn)}</p>
          </motion.div>
        ) : (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted">
            Every rank this season is open.
          </p>
        )}
      </header>
      <div className="p-2">
        <RankLadder state={state} columns />
      </div>
      <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-faint">
        Buy the next rank up, one a day. The price leaves the game and does not count toward your
        net worth. Ranks cannot be stolen or sold, and cannot be bought on the final day.
      </p>
    </section>
  )
}
