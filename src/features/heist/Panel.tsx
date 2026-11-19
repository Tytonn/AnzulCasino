/**
 * The heist panel, opened from the top bar: who you can rob and what each
 * steal would take (Rob), your shield, immunity, today's losses and the
 * vault (Defend), and the season's steals as they happen (Log). It slides in
 * from the right on a wide screen and up from the bottom on a phone, so the
 * game underneath keeps going.
 */
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { chipCount, formatChips, formatShare } from '../../../shared/chips.ts'
import {
  BLOCK_LABELS,
  blockMessage,
  shieldPrice,
  type StealView,
} from '../../../shared/features/heist.ts'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown } from '../../kit/clock.ts'
import { ScrollIcon, ShieldIcon } from '../../kit/icons.tsx'
import { TABLET, useMediaQuery } from '../../kit/media.ts'
import { Avatar, PlayerName } from '../../kit/PlayerName.tsx'
import { usePlayer } from '../../kit/queries.ts'
import { Sheet } from '../../kit/Sheet.tsx'
import { useBuyExtraAttempt, useBuyShield } from './actions.ts'
import { MaskIcon, Pips, ShieldArt, SirenIcon } from './art.tsx'
import { type Heist, type HeistTab, useHeist, useHeistUi, useSteals } from './data.ts'
import type { TargetRow } from './derive.ts'
import { hoursInWords, shortDuration } from './derive.ts'
import { VaultPanel } from './Vault.tsx'

export function HeistPanel() {
  const panel = useHeistUi((s) => s.panel)
  const closePanel = useHeistUi((s) => s.closePanel)
  const tablet = useMediaQuery(TABLET)
  return (
    <Sheet
      open={panel !== null}
      onClose={closePanel}
      title="Heist"
      placement={tablet ? 'right' : 'bottom'}
    >
      {panel && <PanelBody tab={panel} />}
    </Sheet>
  )
}

const TABS: { id: HeistTab; label: string }[] = [
  { id: 'rob', label: 'Rob' },
  { id: 'defend', label: 'Defend' },
  { id: 'log', label: 'Log' },
]

function PanelBody({ tab }: { tab: HeistTab }) {
  const heist = useHeist()
  const openPanel = useHeistUi((s) => s.openPanel)
  const charges = heist.state?.me.charges ?? 0

  const badge: Record<HeistTab, ReactNode> = {
    rob: heist.state ? <Count>{heist.attemptsLeft}</Count> : null,
    defend: charges > 0 ? <Count tone="shield">{charges}</Count> : null,
    log: null,
  }

  return (
    <>
      <div role="tablist" aria-label="Heist" className="flex gap-1 border-b border-border px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`heist-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="heist-tab-panel"
            onClick={() => openPanel(t.id)}
            className={`relative flex h-10 items-center gap-1.5 px-3 text-sm font-semibold transition-colors ${tab === t.id ? 'text-text' : 'text-muted hover:text-text'}`}
          >
            {t.label}
            {badge[t.id]}
            {tab === t.id && (
              <motion.span
                layoutId="heist-tab-line"
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
              />
            )}
          </button>
        ))}
      </div>
      <div
        id="heist-tab-panel"
        role="tabpanel"
        aria-labelledby={`heist-tab-${tab}`}
        className="scroll-quiet min-h-0 flex-1 overflow-y-auto"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.16 }}
            className="p-4"
          >
            {tab === 'rob' && <RobTab heist={heist} />}
            {tab === 'defend' && <DefendTab heist={heist} />}
            {tab === 'log' && <LogTab meId={heist.meId} now={heist.now} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}

function Count({ children, tone = 'accent' }: { children: ReactNode; tone?: 'accent' | 'shield' }) {
  return (
    <span
      className="grid h-4.5 min-w-4.5 place-items-center rounded-full px-1 text-[0.65rem] font-bold text-on-accent tabular-nums"
      style={{ backgroundColor: tone === 'shield' ? 'var(--heist-shield)' : 'var(--accent)' }}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- Rob

function RobTab({ heist }: { heist: Heist }) {
  const extra = useBuyExtraAttempt()
  const state = heist.state
  if (!heist.ready) return <RowsSkeleton />
  if (!state) {
    return (
      <Empty icon={<MaskIcon className="size-8" />}>Steals open when the season is running.</Empty>
    )
  }
  const resetIn = Date.parse(state.nextResetAt) - heist.now
  const allowed = state.me.attemptsAllowed
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-surface-2/60 p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <MaskIcon className="size-6 text-accent-strong" />
            <div className="leading-tight">
              <p className="text-sm font-semibold">
                {heist.attemptsLeft === 1
                  ? '1 attempt left today'
                  : `${heist.attemptsLeft} attempts left today`}
              </p>
              <p className="text-xs text-muted">More at 4:00 AM, in {formatCountdown(resetIn)}</p>
            </div>
          </div>
          <Pips
            filled={heist.attemptsLeft}
            total={allowed}
            size="lg"
            label={`${heist.attemptsLeft} of ${allowed} attempts left`}
          />
        </div>
        {!heist.open ? (
          <p className="mt-3 text-xs text-muted">
            {heist.phase === 'final_day'
              ? `Steals are off for the final ${heist.cfg.final_freeze_hours} hours of the season.`
              : 'Steals open when the season is running.'}
          </p>
        ) : heist.attemptsLeft === 0 && heist.canBuyExtra ? (
          <Button
            variant="primary"
            className="mt-3 w-full"
            onClick={() => void extra.run()}
            disabled={extra.busy}
          >
            Buy one more attempt
          </Button>
        ) : (
          <p className="mt-3 text-xs text-muted">
            {formatShare(heist.cfg.steal_success_pct)} chance. The higher they rank above you, the
            more you take. Get caught and you pay them {formatShare(heist.cfg.steal_fine_pct)} of
            your wallet.
          </p>
        )}
      </div>

      {heist.targets.length === 0 ? (
        <Empty icon={<MaskIcon className="size-8" />}>
          Nobody else is playing this season yet.
        </Empty>
      ) : (
        <ul className="space-y-1.5">
          {heist.targets.map((row) => (
            <TargetItem key={row.standing.userId} row={row} heist={heist} />
          ))}
        </ul>
      )}
    </div>
  )
}

function TargetItem({ row, heist }: { row: TargetRow; heist: Heist }) {
  const rob = useHeistUi((s) => s.rob)
  const player = usePlayer(row.standing.userId)
  const { check, worth } = row
  const reason = check.ok ? null : check.reason
  // When the only block is your own attempts, still show what they are worth.
  const shown = reason === 'no_attempts' ? worth : check
  const immune = !shown.ok && shown.reason === 'immune'
  const name = player?.displayName ?? row.standing.displayName
  const why =
    reason && reason !== 'no_attempts'
      ? blockMessage(reason, {
          name,
          freezeHours: heist.cfg.final_freeze_hours,
          floor: heist.cfg.steal_floor,
          immuneFor: shortDuration(row.immuneLeft),
        })
      : undefined
  return (
    <li
      className={`flex items-center gap-3 rounded-md border px-3 py-2.5 ${immune ? 'heist-immune border-transparent' : 'border-border'} ${check.ok ? 'bg-surface-2' : 'bg-surface-1'}`}
      title={why}
    >
      <span className="w-6 shrink-0 text-center text-xs font-semibold text-faint tabular-nums">
        #{row.standing.rank}
      </span>
      <Avatar player={player ?? row.standing} size="md" />
      <div className="min-w-0 flex-1 leading-tight">
        <PlayerName player={player ?? row.standing} />
        <p className="mt-0.5 truncate text-xs tabular-nums">
          {shown.ok ? (
            <>
              <span className="font-semibold text-gold">+{formatChips(Number(shown.amount))}</span>
              <span className="text-faint"> · {formatShare(shown.rate)} cut</span>
            </>
          ) : immune ? (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: 'var(--heist-shield)' }}
            >
              <ShieldIcon className="size-3" />
              Immune · {formatCountdown(row.immuneLeft)}
            </span>
          ) : (
            <span className="text-muted">{BLOCK_LABELS[shown.reason]}</span>
          )}
        </p>
      </div>
      <Button
        size="sm"
        variant={check.ok ? 'gold' : 'secondary'}
        disabled={!check.ok}
        onClick={() => rob(row.standing.userId)}
        aria-label={`Rob ${name}`}
        className="h-9 px-3"
      >
        <MaskIcon className="size-4" />
        Rob
      </Button>
    </li>
  )
}

// ---------------------------------------------------------------- Defend

function DefendTab({ heist }: { heist: Heist }) {
  const buy = useBuyShield()
  const state = heist.state
  if (!heist.ready) return <RowsSkeleton />
  if (!state) {
    return (
      <Empty icon={<ShieldIcon className="size-8" />}>
        Shields and the vault open when the season is running.
      </Empty>
    )
  }
  const { charges, shieldsThisWeek, stolenToday, lossCap } = state.me
  const max = heist.cfg.shield_max_charges
  const price = shieldPrice(BigInt(heist.balance), heist.cfg)
  const weekLeft = state.me.weekEndsAt ? Date.parse(state.me.weekEndsAt) - heist.now : 0
  let blocked: string | null = null
  if (!heist.open) {
    blocked =
      heist.phase === 'final_day'
        ? `Shields are closed for the final ${heist.cfg.final_freeze_hours} hours of the season.`
        : 'Shields go on sale when the season is running.'
  } else if (charges >= max) blocked = `You hold ${charges}, the most you can hold.`
  else if (shieldsThisWeek >= heist.cfg.shield_weekly_limit)
    blocked = `${shieldsThisWeek} bought this season week, the most allowed. More in ${formatCountdown(weekLeft)}.`
  else if (BigInt(heist.balance) < price)
    blocked = `A charge costs ${chipCount(price)} and you have ${chipCount(heist.balance)}.`
  const lossShare = lossCap > 0 ? Math.min(1, stolenToday / lossCap) : 0

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface-2/60 p-3.5">
        <div className="flex items-center gap-3">
          <div className="h-20 shrink-0">
            <ShieldArt charges={charges} max={max} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {charges === 0
                ? 'No shield'
                : charges === 1
                  ? '1 shield charge'
                  : `${charges} shield charges`}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Each one blocks a steal with no fine for the thief, then gives you{' '}
              {hoursInWords(heist.cfg.immunity_hours)} of immunity. Nobody else can see how many you
              hold.
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          className="mt-3 w-full"
          disabled={blocked !== null || buy.busy}
          onClick={() => void buy.run()}
        >
          {buy.busy ? 'Buying…' : `Buy a charge · ${formatChips(Number(price))}`}
        </Button>
        <p className="mt-2 text-xs text-muted">
          {blocked ??
            `${shieldsThisWeek} of ${heist.cfg.shield_weekly_limit} bought this season week · hold up to ${max}`}
        </p>
      </section>

      <section
        className={`flex items-center gap-3 rounded-lg border p-3.5 ${heist.immuneLeft > 0 ? 'heist-immune border-transparent' : 'border-border bg-surface-2/60'}`}
      >
        <ShieldIcon
          className="size-6 shrink-0"
          style={{ color: heist.immuneLeft > 0 ? 'var(--heist-shield)' : 'var(--text-faint)' }}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold tabular-nums">
            {heist.immuneLeft > 0
              ? `Immune for ${formatCountdown(heist.immuneLeft)}`
              : 'Not immune'}
          </p>
          <p className="text-xs text-muted">
            {heist.immuneLeft > 0
              ? 'Nobody can rob you until it runs out.'
              : 'Immunity starts after someone robs you or your shield blocks them.'}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface-2/60 p-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">Lost to steals today</p>
          <p className="text-xs text-muted tabular-nums">
            <span className={stolenToday > 0 ? 'font-semibold text-loss' : ''}>
              {formatChips(stolenToday)}
            </span>{' '}
            of {formatChips(lossCap)}
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className="h-full rounded-full bg-loss"
            initial={false}
            animate={{ width: `${lossShare * 100}%` }}
            transition={{ type: 'spring', stiffness: 200, damping: 30 }}
          />
        </div>
        <p className="mt-1.5 text-xs text-faint">
          Nobody can take more than {formatShare(heist.cfg.daily_loss_cap_pct)} of your net worth
          (as of 4:00 AM) in one game day.
        </p>
      </section>

      <VaultPanel heist={heist} compact />
    </div>
  )
}

// ---------------------------------------------------------------- Log

function LogTab({ meId, now }: { meId: string; now: number }) {
  const { data: steals, isPending, isError, refetch } = useSteals()
  if (isPending) return <RowsSkeleton />
  if (isError) {
    return (
      <Empty icon={<ScrollIcon className="size-8" />}>
        Could not load the steals.{' '}
        <button type="button" className="text-accent underline" onClick={() => void refetch()}>
          Try again
        </button>
      </Empty>
    )
  }
  if (steals.length === 0) {
    return (
      <Empty icon={<ScrollIcon className="size-8" />}>
        No steals yet this season. Every attempt shows up here.
      </Empty>
    )
  }
  return (
    <ol className="space-y-1">
      <AnimatePresence initial={false}>
        {steals.map((steal) => (
          <motion.li
            key={steal.id}
            layout="position"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          >
            <LogItem
              steal={steal}
              mine={steal.thiefId === meId || steal.targetId === meId}
              now={now}
            />
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  )
}

function LogItem({ steal, mine, now }: { steal: StealView; mine: boolean; now: number }) {
  const thief = usePlayer(steal.thiefId)
  const target = usePlayer(steal.targetId)
  const Thief = <PlayerName player={thief} badge={false} />
  const Target = <PlayerName player={target} badge={false} />
  let icon: ReactNode
  let line: ReactNode
  let amount: ReactNode = null
  if (steal.outcome === 'success') {
    icon = <MaskIcon className="size-4 text-gold" />
    line = (
      <>
        {Thief} robbed {Target}
      </>
    )
    amount = <span className="font-semibold text-gold">{formatChips(steal.amount)}</span>
  } else if (steal.outcome === 'blocked') {
    icon = <ShieldIcon className="size-4" style={{ color: 'var(--heist-shield)' }} />
    line = (
      <>
        {Target}’s shield blocked {Thief}
      </>
    )
  } else {
    icon = <SirenIcon className="size-4 text-loss" />
    line = (
      <>
        {Thief} got caught robbing {Target}
      </>
    )
    if (steal.fine > 0) amount = <span className="text-loss">fined {formatChips(steal.fine)}</span>
  }
  return (
    <div
      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${mine ? 'bg-surface-2' : ''}`}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-3">
        {icon}
      </span>
      <p className="min-w-0 flex-1 leading-snug [&>span]:align-baseline">{line}</p>
      <div className="shrink-0 text-right text-xs leading-tight tabular-nums">
        {amount}
        <p className="text-faint">{ago(steal.createdAt, now)}</p>
      </div>
    </div>
  )
}

function ago(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

// ---------------------------------------------------------------- states

function RowsSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading">
      <div className="skeleton h-20" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton h-14" />
      ))}
    </div>
  )
}

function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="grid place-items-center gap-3 px-6 py-12 text-center text-sm text-muted">
      <span className="grid size-14 place-items-center rounded-lg border border-border bg-surface-2 text-faint">
        {icon}
      </span>
      <p className="max-w-60">{children}</p>
    </div>
  )
}
