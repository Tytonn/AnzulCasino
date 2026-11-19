/**
 * Heist in the top bar and on the profile card (spec: Shields: "The top bar
 * shows charges as pips and immunity as an exact countdown"):
 *
 * - Steals: your attempts left today as pips. Opens the heist panel.
 * - Shield: your charges as pips, or your immunity counting down. Opens Defend.
 * - Rob: on another player's card, what a steal would take, or why not.
 *
 * The two top-bar buttons are built like the economy's beside them: an icon
 * over one short value, about 2.75rem wide, lit while there is something to
 * use. The whole story is in each button's label and tooltip.
 */
import { motion } from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'

import { formatChips } from '../../../shared/chips.ts'
import { blockMessage } from '../../../shared/features/heist.ts'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown } from '../../kit/clock.ts'
import { ShieldIcon } from '../../kit/icons.tsx'
import type { SlotProps } from '../../shell/manifests.ts'
import { MaskIcon, Pips } from './art.tsx'
import { useHeist, useHeistUi } from './data.ts'
import { barCountdown, shortDuration } from './derive.ts'

type BarProps = SlotProps['top-bar']

const HOUR_MS = 3_600_000

// ---------------------------------------------------------------- the top-bar button

const TINT = 'bg-[color-mix(in_oklab,var(--tone)_13%,var(--surface-2))]'
const TINT_HOVER = 'hover:bg-[color-mix(in_oklab,var(--tone)_22%,var(--surface-2))]'

interface BarButtonProps extends BarProps {
  data: string
  /** A color variable for the icon and the lit look. */
  tone: string
  /** Lit up: something to use (attempts left, a charge, immunity running). */
  lit: boolean
  icon: (className: string) => ReactNode
  /** One short value under the icon. */
  value: ReactNode
  /** What a screen reader says: the whole story. */
  label: string
  title: string
  onClick: () => void
  /** Closed for now, such as on the season's final day. */
  faded?: boolean
  /** Immune: the ring pulses in the shield's color. */
  glow?: boolean
  /** 0 to 1, a thin bar along the bottom: how much immunity is left. */
  progress?: number | null
}

function BarButton({
  compact,
  data,
  tone,
  lit,
  icon,
  value,
  label,
  title,
  onClick,
  faded = false,
  glow = false,
  progress = null,
}: BarButtonProps) {
  const look = glow
    ? `heist-immune border-transparent ${TINT} ${TINT_HOVER}`
    : lit
      ? `border-[color-mix(in_oklab,var(--tone)_55%,var(--border))] ${TINT} ${TINT_HOVER}`
      : 'border-border bg-surface-2/40 hover:border-border-strong hover:bg-surface-2'
  return (
    <button
      type="button"
      data-heist={data}
      aria-label={label}
      title={title}
      onClick={onClick}
      style={{ '--tone': tone } as CSSProperties}
      className={`group relative flex min-w-[2.75rem] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border px-1.5 transition duration-150 select-none active:scale-[0.96] ${
        compact ? 'h-10' : 'h-11'
      } ${look} ${faded ? 'opacity-60' : ''}`}
    >
      <motion.span
        key={lit ? 'lit' : 'dim'}
        className={`block ${lit ? 'text-(--tone)' : 'text-faint group-hover:text-muted'}`}
        initial={{ scale: lit ? 0.5 : 1 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 18 }}
      >
        {icon(compact ? 'size-4' : 'size-4 desk:size-[1.15rem]')}
      </motion.span>
      {/* One line box the height of the economy's values, so the icons line up. */}
      <span
        className={`flex h-[1em] items-center leading-none font-semibold whitespace-nowrap tabular-nums ${
          compact ? 'text-[0.66rem]' : 'text-[0.66rem] desk:text-[0.72rem]'
        }`}
      >
        {value}
      </span>
      {progress !== null && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-0 h-0.5 bg-[color-mix(in_oklab,var(--tone)_70%,transparent)] transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      )}
    </button>
  )
}

function BarSkeleton({ compact }: BarProps) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton block w-[2.75rem] shrink-0 rounded-md ${compact ? 'h-10' : 'h-11'}`}
    />
  )
}

// ---------------------------------------------------------------- steals and shield

export function StealsWidget({ compact }: BarProps) {
  const heist = useHeist()
  const openPanel = useHeistUi((s) => s.openPanel)
  if (!heist.ready) return <BarSkeleton compact={compact} />
  const state = heist.state
  if (!state) return null
  const allowed = state.me.attemptsAllowed
  const left = heist.open ? heist.attemptsLeft : 0
  const label = heist.open
    ? `Steals: ${heist.attemptsLeft} of ${allowed} attempts left today`
    : 'Steals are closed right now'
  return (
    <BarButton
      compact={compact}
      data="steals"
      tone="var(--accent-strong)"
      lit={left > 0}
      faded={!heist.open}
      icon={(className) => <MaskIcon className={className} />}
      value={<Pips filled={left} total={allowed} size="sm" />}
      label={`${label}. Open the heist panel.`}
      title={label}
      onClick={() => openPanel('rob')}
    />
  )
}

export function ShieldWidget({ compact }: BarProps) {
  const heist = useHeist()
  const openPanel = useHeistUi((s) => s.openPanel)
  if (!heist.ready) return <BarSkeleton compact={compact} />
  const state = heist.state
  if (!state) return null
  const charges = state.me.charges
  const max = heist.cfg.shield_max_charges
  const immune = heist.immuneLeft > 0
  const span = heist.cfg.immunity_hours * HOUR_MS
  const label = [
    charges === 1 ? '1 shield charge' : `${charges} shield charges`,
    immune ? `immune for ${formatCountdown(heist.immuneLeft)}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <BarButton
      compact={compact}
      data="shield"
      tone="var(--heist-shield)"
      lit={charges > 0 || immune}
      glow={immune}
      icon={(className) => <ShieldIcon className={className} />}
      value={
        immune ? (
          <span className="text-(--tone)">{barCountdown(heist.immuneLeft)}</span>
        ) : (
          <Pips filled={charges} total={max} shape="shield" tone="shield" size="sm" />
        )
      }
      label={`${label}. Open your defenses.`}
      title={label}
      progress={immune && span > 0 ? Math.min(1, heist.immuneLeft / span) : null}
      onClick={() => openPanel('defend')}
    />
  )
}

/** Rob, on another player's profile card. */
export function StealAction({ player }: SlotProps['profile-actions']) {
  const heist = useHeist()
  const rob = useHeistUi((s) => s.rob)
  if (!heist.ready || !heist.state) return null
  const row = heist.target(player.id)
  const check = row?.check
  const name = player.displayName
  const why = !check
    ? blockMessage('unknown')
    : check.ok
      ? null
      : blockMessage(check.reason, {
          name,
          freezeHours: heist.cfg.final_freeze_hours,
          floor: heist.cfg.steal_floor,
          immuneFor: row ? shortDuration(row.immuneLeft) : undefined,
          canBuyExtra: heist.canBuyExtra,
        })
  // Out of attempts with the extra one for sale: the dialog sells it.
  const canOpen = check?.ok === true || (check?.reason === 'no_attempts' && heist.canBuyExtra)
  return (
    <>
      <Button
        variant={check?.ok ? 'gold' : 'secondary'}
        disabled={!canOpen}
        onClick={() => rob(player.id)}
        className="h-10"
      >
        <MaskIcon className="size-4.5" />
        Rob {name}
        {check?.ok && (
          <span className="font-normal opacity-80 tabular-nums">
            · +{formatChips(Number(check.amount))}
          </span>
        )}
      </Button>
      {why && <p className="basis-full text-xs text-muted">{why}</p>}
    </>
  )
}
