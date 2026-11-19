/**
 * Typed bets (spec: The room model, added by Tyton on Nov 18, 2026). The bet
 * box accepts a number or shorthand: "250", "12.50", "1,000", "5k", "2.5k",
 * "1.2m", "all", "max", "half". The browser uses this to preview the amount;
 * the server resolves the same text again against the locked wallet, so
 * "all" is exactly the balance at the moment the bet is placed. "max" is the
 * largest bet the limits allow: the whole wallet while `max_bet_pct` is 100%.
 *
 * Amounts are in hundredths. Anything finer than a hundredth rounds down.
 */
import { basisPoints, CHIP, chipCount, formatChips, formatShare } from './chips.ts'

export type BetAmountResult =
  | { ok: true; amount: bigint; keyword: 'all' | 'half' | 'max' | null }
  | { ok: false; error: string }

const SUFFIXES: Record<string, bigint> = { k: 1_000n, m: 1_000_000n, b: 1_000_000_000n }

/**
 * Parses typed text into hundredths. `balance` resolves "all" and "half", and
 * `limits` resolves "max" (the whole wallet without them).
 */
export function parseBetAmount(
  text: string,
  balance: bigint,
  limits?: Pick<BetLimits, 'maxBetPct'>,
): BetAmountResult {
  const input = text.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '')
  if (!input) return { ok: false, error: 'Type an amount, like 50, 2.5k, half or all.' }

  if (input === 'all' || input === 'allin' || input === 'all-in') {
    return { ok: true, amount: balance, keyword: 'all' }
  }
  if (input === 'max') {
    return { ok: true, amount: maxBet(balance, limits), keyword: 'max' }
  }
  if (input === 'half') return { ok: true, amount: balance / 2n, keyword: 'half' }

  const match = /^(\d+)(?:\.(\d*))?([kmb])?$|^\.(\d+)([kmb])?$/.exec(input)
  if (!match)
    return { ok: false, error: `"${text.trim()}" is not an amount. Try 50, 2.5k, half or all.` }

  const whole = match[1] ?? '0'
  const fraction = match[2] ?? match[4] ?? ''
  const suffix = match[3] ?? match[5]
  const multiplier = suffix ? (SUFFIXES[suffix] as bigint) : 1n

  // Exact decimal arithmetic: value = whole.fraction * multiplier chips.
  const scale = 10n ** BigInt(fraction.length)
  const numerator = (BigInt(whole) * scale + BigInt(fraction || '0')) * multiplier * CHIP
  const amount = numerator / scale // rounds down to a hundredth
  return { ok: true, amount, keyword: null }
}

/** The config values `min_bet` and `max_bet_pct`. */
export interface BetLimits {
  /** Smallest bet, hundredths. */
  minBet: bigint
  /** Largest bet as a share of the wallet, in basis points. 10,000 (100%) allows all-in. */
  maxBetPct: number
}

/** The largest bet the limits allow from this balance. */
export function maxBet(balance: bigint, limits?: Pick<BetLimits, 'maxBetPct'>): bigint {
  if (balance <= 0n) return 0n
  if (!limits || limits.maxBetPct >= 10_000) return balance
  return basisPoints(balance, limits.maxBetPct)
}

/** Checks a parsed amount against the wallet and the limits. */
export function checkBetAmount(amount: bigint, balance: bigint, limits: BetLimits): string | null {
  if (amount <= 0n) return balance <= 0n ? 'Your wallet is empty.' : 'Bet more than zero.'
  if (amount < limits.minBet) return `The smallest bet is ${formatChips(limits.minBet)}.`
  if (amount > balance) return `You only have ${chipCount(balance)}.`
  const max = maxBet(balance, limits)
  if (amount > max) {
    return `The largest bet right now is ${formatChips(max)} (${formatShare(limits.maxBetPct)} of your wallet).`
  }
  return null
}
