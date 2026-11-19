/**
 * The vault (spec: Vault): chips in it cannot be stolen or bet, and still
 * count toward rank. It holds up to a quarter of net worth, checked at the
 * moment of a deposit, and takes one move a game day, in or out. The amount
 * is typed like a bet: 20, 2.5k, half or max.
 */
import { motion, useReducedMotion } from 'motion/react'
import { type FormEvent, useState } from 'react'

import { formatChips, formatShare } from '../../../shared/chips.ts'
import {
  parseVaultAmount,
  type VaultDirection,
  vaultMoveProblem,
  vaultRoom,
} from '../../../shared/features/heist.ts'
import { AnimatedNumber } from '../../kit/AnimatedNumber.tsx'
import { Button } from '../../kit/Button.tsx'
import { formatCountdown } from '../../kit/clock.ts'
import { VaultIcon } from '../../kit/icons.tsx'
import { useVaultMove } from './actions.ts'
import { LockIcon } from './art.tsx'
import type { Heist } from './data.ts'

const DIRECTIONS: { id: VaultDirection; label: string }[] = [
  { id: 'deposit', label: 'Deposit' },
  { id: 'withdraw', label: 'Withdraw' },
]

export function VaultPanel({ heist, compact = false }: { heist: Heist; compact?: boolean }) {
  const reduced = useReducedMotion()
  const [direction, setDirection] = useState<VaultDirection>('deposit')
  const [text, setText] = useState('')
  const vaultMove = useVaultMove()
  const [slams, setSlams] = useState(0)

  const balance = BigInt(heist.balance)
  const vault = BigInt(heist.vault)
  const cap = heist.cfg.vault_cap_pct
  const worth = balance + vault
  const allowed = worth > 0n ? (worth * BigInt(cap)) / 10_000n : 0n
  const room = vaultRoom(balance, vault, cap)
  const fill = allowed > 0n ? Math.min(1, Number(vault) / Number(allowed)) : 0
  const moved = heist.state?.me.vaultMoved ?? false
  const nextReset = heist.state ? Date.parse(heist.state.nextResetAt) : 0
  const closed = !heist.open

  const typed = text.trim()
  const parsed = typed ? parseVaultAmount(typed, direction, balance, vault, cap) : null
  const problem =
    parsed?.ok === true ? vaultMoveProblem(direction, parsed.amount, balance, vault, cap) : null
  const ready = parsed?.ok === true && problem === null && !moved && !closed

  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!ready || vaultMove.busy) return
    const done = await vaultMove.move(direction, typed)
    if (done) {
      setText('')
      setSlams((n) => n + 1)
    }
  }

  let note: { text: string; tone: 'muted' | 'loss' | 'text' }
  if (closed) {
    note = {
      text:
        heist.phase === 'final_day'
          ? `Vault moves are closed for the final ${heist.cfg.final_freeze_hours} hours of the season.`
          : 'The vault opens when the season is running.',
      tone: 'muted',
    }
  } else if (moved) {
    note = {
      text: `One move a game day. The next one opens in ${formatCountdown(nextReset - heist.now)}.`,
      tone: 'muted',
    }
  } else if (parsed && !parsed.ok) {
    note = { text: parsed.error, tone: 'loss' }
  } else if (problem) {
    note = { text: problem.message, tone: 'loss' }
  } else if (parsed?.ok) {
    note = {
      text: `= ${formatChips(Number(parsed.amount))} chips ${direction === 'deposit' ? 'into the vault' : 'back to your wallet'}`,
      tone: 'text',
    }
  } else {
    note = {
      text:
        direction === 'deposit'
          ? room > 0n
            ? `Room for ${formatChips(Number(room))} more. One move a game day.`
            : `Full: it holds up to ${formatShare(cap)} of your net worth.`
          : 'Take chips back to bet with them. One move a game day.',
      tone: 'muted',
    }
  }

  const disabled = closed || moved

  return (
    <section
      aria-label="Your vault"
      className={`rounded-lg border border-border bg-surface-2/60 ${compact ? 'p-3.5' : 'p-4'}`}
    >
      <div className="flex items-center gap-3">
        <motion.div
          key={slams}
          className="grid size-12 shrink-0 place-items-center rounded-md border border-border-strong bg-surface-3"
          style={{ color: 'var(--heist-steel-light)' }}
          initial={slams > 0 && !reduced ? { scale: 1.25, rotate: -12 } : false}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 520, damping: 14 }}
        >
          {disabled ? <LockIcon className="size-6" /> : <VaultIcon className="size-7" />}
        </motion.div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.7rem] font-semibold tracking-[0.12em] text-faint uppercase">
            Vault
          </p>
          <AnimatedNumber value={heist.vault} className="text-2xl font-bold" />
        </div>
        <p className="max-w-[9rem] text-right text-xs text-muted">
          Safe from steals. Still counts toward your rank.
        </p>
      </div>

      <div className="mt-3">
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-3"
          role="meter"
          aria-label="Vault filled"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fill * 100)}
        >
          <motion.div
            className="h-full rounded-full"
            style={{
              background: 'linear-gradient(90deg, var(--heist-steel), var(--heist-steel-light))',
            }}
            initial={false}
            animate={{ width: `${fill * 100}%` }}
            transition={{ type: 'spring', stiffness: 200, damping: 30 }}
          />
        </div>
        <p className="mt-1.5 flex justify-between text-xs text-faint tabular-nums">
          <span>
            {formatChips(heist.vault)} of {formatChips(Number(allowed))} allowed
          </span>
          <span>{formatShare(cap)} of net worth</span>
        </p>
      </div>

      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-2">
        <div
          role="radiogroup"
          aria-label="Direction"
          className="grid grid-cols-2 gap-1 rounded-md border border-border bg-surface-1 p-1"
        >
          {DIRECTIONS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={direction === d.id}
              disabled={disabled}
              onClick={() => {
                setDirection(d.id)
                setText('')
              }}
              className={`h-9 rounded-sm text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
                direction === d.id
                  ? 'bg-surface-3 text-text shadow-card'
                  : 'text-muted hover:text-text'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label
            className={`flex h-11 min-w-0 flex-1 items-center gap-1 rounded-md border bg-surface-1 pr-1 pl-3 transition-colors focus-within:border-accent ${
              note.tone === 'loss' && typed ? 'border-loss/70' : 'border-border'
            }`}
          >
            <span className="sr-only">Amount to {direction}</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={disabled}
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              placeholder="20, half or max"
              aria-describedby="heist-vault-note"
              className="h-full min-w-0 flex-1 bg-transparent font-semibold tabular-nums placeholder:font-normal placeholder:text-faint focus:outline-none disabled:cursor-not-allowed"
            />
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => setText('half')}
              aria-label="Half"
            >
              ½
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setText('max')}>
              Max
            </Button>
          </label>
          <Button
            type="submit"
            variant="primary"
            className="h-11 min-w-24"
            disabled={!ready || vaultMove.busy}
          >
            {direction === 'deposit' ? 'Lock in' : 'Take out'}
          </Button>
        </div>
        <p
          id="heist-vault-note"
          aria-live="polite"
          className={`min-h-5 text-xs ${note.tone === 'loss' ? 'text-loss' : note.tone === 'text' ? 'text-text tabular-nums' : 'text-muted'}`}
        >
          {note.text}
        </p>
      </form>
    </section>
  )
}
