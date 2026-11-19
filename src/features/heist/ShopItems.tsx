/**
 * Heist's cards in the Shop (spec: Shields, Shop): a shield charge and the
 * one extra steal attempt a game day. Both are `shop-items` slot entries, so
 * they sit in the same grid as other lanes' items, such as ranks. Each card
 * says what it does, what it costs from your wallet right now, and why it
 * cannot be bought when it cannot.
 */
import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { chipCount, formatChips, formatShare } from '../../../shared/chips.ts'
import { extraAttemptPrice, shieldPrice } from '../../../shared/features/heist.ts'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown } from '../../kit/clock.ts'
import { ChipIcon } from '../../kit/icons.tsx'
import { Kbd, useShortcuts } from '../../kit/Kbd.tsx'
import { useBuyExtraAttempt, useBuyShield } from './actions.ts'
import { ExtraAttemptArt, Pips, ShieldArt } from './art.tsx'
import { type Heist, useHeist } from './data.ts'
import { hoursInWords } from './derive.ts'

function ShopCard({
  art,
  tint,
  title,
  pitch,
  price,
  priceNote,
  status,
  blocked,
  action,
}: {
  art: ReactNode
  tint: string
  title: string
  pitch: string
  price: bigint | null
  priceNote: string
  status: ReactNode
  blocked: string | null
  action: ReactNode
}) {
  return (
    <motion.article
      layout
      className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface-1 shadow-card"
    >
      <div
        className="relative grid h-32 place-items-center overflow-hidden py-3"
        style={{
          background: `radial-gradient(120% 90% at 50% 0%, color-mix(in oklab, ${tint} 24%, var(--surface-2)), var(--surface-1))`,
        }}
      >
        {art}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">{title}</h2>
            {price !== null && (
              <span className="flex shrink-0 items-center gap-1 text-sm font-bold text-gold tabular-nums">
                <ChipIcon className="size-4" />
                {formatChips(Number(price))}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">{pitch}</p>
          <p className="mt-1 text-xs text-faint">{priceNote}</p>
        </div>
        <div className="mt-auto space-y-3">
          <div className="text-xs text-muted">{status}</div>
          {blocked && <p className="text-xs text-muted">{blocked}</p>}
          {action}
        </div>
      </div>
    </motion.article>
  )
}

function closedNote(heist: Heist, what: string): string {
  return heist.phase === 'final_day'
    ? `${what} closed for the final ${heist.cfg.final_freeze_hours} hours of the season.`
    : `${what} on sale while a season is running.`
}

export function ShieldItem() {
  const heist = useHeist()
  const buy = useBuyShield()
  const state = heist.state
  const price = shieldPrice(BigInt(heist.balance), heist.cfg)
  const charges = state?.me.charges ?? 0
  const max = heist.cfg.shield_max_charges
  const week = state?.me.shieldsThisWeek ?? 0
  const weekLimit = heist.cfg.shield_weekly_limit
  const weekLeft = state?.me.weekEndsAt ? Date.parse(state.me.weekEndsAt) - heist.now : 0

  let blocked: string | null = null
  if (!heist.open) blocked = closedNote(heist, 'Shields are')
  else if (!state) blocked = null
  else if (charges >= max) blocked = `You hold ${charges} charges, the most you can hold.`
  else if (week >= weekLimit)
    blocked = `You bought ${week} this season week, the most allowed. More in ${formatCountdown(weekLeft)}.`
  else if (BigInt(heist.balance) < price)
    blocked = `It costs ${chipCount(price)} and you have ${chipCount(heist.balance)}.`

  const can = heist.open && state !== null && blocked === null
  useShortcuts({ s: () => can && void buy.run() })

  return (
    <ShopCard
      art={<ShieldArt charges={charges} max={max} />}
      tint="var(--heist-shield)"
      title="Shield charge"
      pitch={`Blocks the next steal against you, with no fine for the thief, then ${hoursInWords(heist.cfg.immunity_hours)} of immunity.`}
      price={heist.open ? price : null}
      priceNote={`${formatShare(heist.cfg.shield_price_pct)} of your wallet, at least ${chipCount(heist.cfg.shield_price_min)}. The chips leave the game.`}
      status={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <Pips
              filled={charges}
              total={max}
              shape="shield"
              tone="shield"
              label={`${charges} of ${max} charges`}
            />
            {charges} of {max} held
          </span>
          <span className="text-faint">
            {week} of {weekLimit} bought this week
          </span>
        </span>
      }
      blocked={blocked}
      action={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!can || buy.busy}
          onClick={() => void buy.run()}
        >
          {buy.busy ? 'Buying…' : 'Buy a charge'}
          <Kbd>S</Kbd>
        </Button>
      }
    />
  )
}

export function ExtraAttemptItem() {
  const heist = useHeist()
  const buy = useBuyExtraAttempt()
  const state = heist.state
  const price = extraAttemptPrice(BigInt(heist.balance), heist.cfg)
  const free = heist.cfg.steal_attempts_per_day
  const bought = state?.me.extraBought ?? false
  const resetIn = state ? Date.parse(state.nextResetAt) - heist.now : 0

  let blocked: string | null = null
  if (!heist.open) blocked = closedNote(heist, 'Steals are')
  else if (!state) blocked = null
  else if (bought)
    blocked = `Bought for today. The next one is on sale in ${formatCountdown(resetIn)}.`
  else if (BigInt(heist.balance) < price)
    blocked = `It costs ${chipCount(price)} and you have ${chipCount(heist.balance)}.`

  const can = heist.open && state !== null && blocked === null
  useShortcuts({ e: () => can && void buy.run() })

  return (
    <ShopCard
      art={<ExtraAttemptArt />}
      tint="var(--accent)"
      title="Extra steal attempt"
      pitch={`One more try today, on top of your ${free} free ones. One a game day.`}
      price={heist.open ? price : null}
      priceNote={`${formatShare(heist.cfg.extra_steal_price_pct)} of your wallet, at least ${chipCount(heist.cfg.extra_steal_price_min)}.`}
      status={
        state && (
          <span className="flex items-center gap-1.5">
            <Pips
              filled={heist.attemptsLeft}
              total={state.me.attemptsAllowed}
              label={`${heist.attemptsLeft} attempts left today`}
            />
            {heist.attemptsLeft === 1
              ? '1 attempt left today'
              : `${heist.attemptsLeft} attempts left today`}
          </span>
        )
      }
      blocked={blocked}
      action={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!can || buy.busy}
          onClick={() => void buy.run()}
        >
          {buy.busy ? 'Buying…' : 'Buy one more'}
          <Kbd>E</Kbd>
        </Button>
      }
    />
  )
}
