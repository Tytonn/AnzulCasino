/**
 * The Shop (spec: Shop): every lane's items in one grid (the `shop-items`
 * slot: heist's shield charge and extra steal attempt, the economy lane's
 * ranks), the vault, and how heists work in a few lines, with the numbers
 * from config.
 */
import type { ReactNode } from 'react'

import { chipCount, formatChips, formatShare } from '../../../shared/chips.ts'
import { Button } from '../../kit/Button.tsx'
import { BagIcon, ChipIcon } from '../../kit/icons.tsx'
import { Kbd, useShortcuts } from '../../kit/Kbd.tsx'
import { Slot, useSlot } from '../../shell/Slot.tsx'
import { LockIcon, MaskIcon } from './art.tsx'
import { type Heist, useHeist, useHeistUi } from './data.ts'
import { hoursInWords } from './derive.ts'
import { VaultPanel } from './Vault.tsx'

export default function ShopPage() {
  const heist = useHeist()
  const openPanel = useHeistUi((s) => s.openPanel)
  const items = useSlot('shop-items')
  useShortcuts({ r: () => openPanel('rob') })

  return (
    <div className="mx-auto w-full max-w-6xl p-4 pb-10 md:p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <BagIcon className="size-4" />
            Spend chips on an edge
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight md:text-3xl">Shop</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm text-muted tabular-nums">
            <ChipIcon className="size-4 text-gold" />
            {formatChips(heist.balance)} in your wallet
          </span>
          <Button size="md" variant="secondary" onClick={() => openPanel('rob')}>
            <MaskIcon className="size-4.5" />
            Pick a target
            <Kbd>R</Kbd>
          </Button>
        </div>
      </header>

      {heist.phase === 'final_day' && (
        <p className="mb-5 flex items-center gap-2.5 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
          <LockIcon className="size-5 shrink-0 text-gold" />
          The final {heist.cfg.final_freeze_hours} hours: steals, shields and vault moves are closed
          until the season ends. The tables are still open.
        </p>
      )}

      {items.length > 0 && (
        <section
          aria-label="For sale"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          <Slot name="shop-items" props={{}} />
        </section>
      )}

      <div className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <VaultPanel heist={heist} />
        <HowItWorks heist={heist} />
      </div>
    </div>
  )
}

function HowItWorks({ heist }: { heist: Heist }) {
  const { cfg } = heist
  const rules: ReactNode[] = [
    <>
      You get <b>{cfg.steal_attempts_per_day} steal attempts</b> a game day, and can buy one more.
      Pick a target from the leaderboard or their profile.
    </>,
    <>
      A steal works <b>{formatShare(cfg.steal_success_pct)}</b> of the time. It takes{' '}
      {formatShare(cfg.steal_base_rate)} of their wallet, plus {formatShare(cfg.steal_per_rank)} for
      each place they are above you, up to {formatShare(cfg.steal_max_rate)}. Robbing someone below
      you takes {formatShare(cfg.steal_down_rate)}. A steal that would take under{' '}
      {chipCount(cfg.steal_min_take)} cannot be tried.
    </>,
    <>
      Get caught and you pay them <b>{formatShare(cfg.steal_fine_pct)} of your wallet</b>, at least{' '}
      {chipCount(cfg.steal_min_fine)} (or all of it, if you have less).
    </>,
    <>
      A shield charge blocks a steal outright. After a block or a successful steal, the target is
      immune for {hoursInWords(cfg.immunity_hours)}.
    </>,
    <>
      Nobody loses more than {formatShare(cfg.daily_loss_cap_pct)} of their net worth to steals in a
      game day, and the vault keeps up to {formatShare(cfg.vault_cap_pct)} of it out of reach.
    </>,
    <>Everything stops for the final {cfg.final_freeze_hours} hours of the season.</>,
  ]
  return (
    <section
      aria-labelledby="heist-how"
      className="rounded-lg border border-border bg-surface-1 p-4 shadow-card"
    >
      <h2 id="heist-how" className="flex items-center gap-2 text-base font-semibold">
        <MaskIcon className="size-5 text-accent-strong" />
        How heists work
      </h2>
      <ol className="mt-3 space-y-2.5 text-sm text-muted [&_b]:font-semibold [&_b]:text-text">
        {rules.map((rule, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-surface-3 text-[0.65rem] font-bold text-faint">
              {i + 1}
            </span>
            <span>{rule}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
