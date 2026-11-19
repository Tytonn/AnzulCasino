/**
 * Heist in the top bar and on the profile card (spec: Shields: "The top bar
 * shows charges as pips and immunity as an exact countdown"):
 *
 * - Steals: your attempts left today as pips. Opens the heist panel.
 * - Shield: your charges as pips, and your immunity counting down.
 * - Rob: on another player's card, what a steal would take, or why not.
 */
import { formatChips } from '../../../shared/chips.ts'
import { blockMessage } from '../../../shared/features/heist.ts'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown } from '../../kit/clock.ts'
import { ShieldIcon } from '../../kit/icons.tsx'
import type { SlotProps } from '../../shell/manifests.ts'
import { MaskIcon, Pips } from './art.tsx'
import { useHeist, useHeistUi } from './data.ts'
import { shortDuration } from './derive.ts'

const PILL =
  'flex shrink-0 items-center rounded-md border transition hover:border-border-strong hover:bg-surface-3 active:scale-95'

export function StealsWidget({ compact }: SlotProps['top-bar']) {
  const heist = useHeist()
  const openPanel = useHeistUi((s) => s.openPanel)
  if (!heist.ready)
    return <div className={`skeleton shrink-0 ${compact ? 'h-9 w-16' : 'h-10 w-24'}`} />
  const state = heist.state
  if (!state) return null
  const allowed = state.me.attemptsAllowed
  const left = heist.attemptsLeft
  const label = heist.open
    ? `Steals: ${left} of ${allowed} attempts left today`
    : 'Steals are closed right now'
  return (
    <button
      type="button"
      onClick={() => openPanel('rob')}
      title={label}
      aria-label={`${label}. Open the heist panel.`}
      className={`${PILL} border-border bg-surface-2 ${compact ? 'h-9 gap-1.5 px-2' : 'h-10 gap-2 px-2.5'} ${heist.open ? '' : 'opacity-60'}`}
    >
      <MaskIcon
        className={`${compact ? 'size-4.5' : 'size-5'} ${left > 0 && heist.open ? 'text-accent-strong' : 'text-faint'}`}
      />
      {compact ? (
        <Pips filled={heist.open ? left : 0} total={allowed} size="sm" />
      ) : (
        <span className="flex flex-col items-start leading-none">
          <span className="text-[0.6rem] tracking-[0.1em] text-faint uppercase">Steals</span>
          <span className="mt-1">
            <Pips filled={heist.open ? left : 0} total={allowed} size="sm" />
          </span>
        </span>
      )}
    </button>
  )
}

export function ShieldWidget({ compact }: SlotProps['top-bar']) {
  const heist = useHeist()
  const openPanel = useHeistUi((s) => s.openPanel)
  if (!heist.ready)
    return <div className={`skeleton shrink-0 ${compact ? 'h-9 w-16' : 'h-10 w-24'}`} />
  const state = heist.state
  if (!state) return null
  const charges = state.me.charges
  const max = heist.cfg.shield_max_charges
  const immune = heist.immuneLeft > 0
  const lit = charges > 0 || immune
  const label = [
    charges === 1 ? '1 shield charge' : `${charges} shield charges`,
    immune ? `immune for ${formatCountdown(heist.immuneLeft)}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <button
      type="button"
      onClick={() => openPanel('defend')}
      title={label}
      aria-label={`${label}. Open your defenses.`}
      className={`${PILL} ${immune ? 'heist-immune border-transparent' : 'border-border'} bg-surface-2 ${compact ? 'h-9 gap-1.5 px-2' : 'h-10 gap-2 px-2.5'}`}
    >
      <ShieldIcon
        className={compact ? 'size-4.5' : 'size-5'}
        style={{ color: lit ? 'var(--heist-shield)' : 'var(--text-faint)' }}
      />
      {compact ? (
        immune ? (
          <span
            className="text-xs font-semibold tabular-nums"
            style={{ color: 'var(--heist-shield)' }}
          >
            {formatCountdown(heist.immuneLeft)}
          </span>
        ) : (
          <Pips filled={charges} total={max} shape="shield" tone="shield" size="sm" />
        )
      ) : (
        <span className="flex flex-col items-start leading-none">
          <span className="text-[0.6rem] tracking-[0.1em] text-faint uppercase">
            {immune ? 'Immune' : 'Shield'}
          </span>
          {immune ? (
            <span
              className="mt-0.5 text-sm font-semibold tabular-nums"
              style={{ color: 'var(--heist-shield)' }}
            >
              {formatCountdown(heist.immuneLeft)}
            </span>
          ) : (
            <span className="mt-0.5">
              <Pips filled={charges} total={max} shape="shield" tone="shield" size="sm" />
            </span>
          )}
        </span>
      )}
    </button>
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
