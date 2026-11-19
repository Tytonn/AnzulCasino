/**
 * Roulette's rules engine: the draw, the schedule and turning typed bets into
 * chips. The table's spots and payouts are shared with the browser
 * (shared/games/roulette.ts); the number itself is server randomness only.
 */
import { type BetLimits, checkBetAmount, parseBetAmount } from '../../../shared/bet-amount.ts'
import {
  POCKETS,
  type RouletteClock,
  type SpinTiming,
  type SpinWindow,
  seasonClock,
  spinWindow,
  spotById,
} from '../../../shared/games/roulette.ts'
import { randomBelow } from '../../lib/rng.ts'

/**
 * Draws the winning number: 0 to 36, each with odds of 1 in 37, from
 * node:crypto's randomInt (no modulo bias). Called only once betting has
 * closed (rule 7, draw late).
 */
export function drawNumber(): number {
  return randomBelow(POCKETS)
}

/** What a saved spin keeps in shared_rounds.result: its timings, and its number once drawn. */
export interface StoredSpin {
  timing: SpinTiming
  number: number | null
}

/** The fields of a saved spin the schedule needs. */
export interface SavedSpin {
  roundNo: number
  opensAt: Date
  result: unknown
}

/** A saved spin's times, from the timings it was created with. */
export function savedWindow(spin: SavedSpin, fallback: SpinTiming): SpinWindow {
  const stored = spin.result as Partial<StoredSpin> | null
  return spinWindow(spin.roundNo, spin.opensAt.getTime(), stored?.timing ?? fallback)
}

/**
 * The schedule: anchored on the season's latest saved spin, or on the
 * season's start when none is saved yet, with spins after it following the
 * timings in force now.
 */
export function clockFrom(
  latest: SavedSpin | null,
  seasonStartsAt: Date,
  timing: SpinTiming,
): RouletteClock {
  if (!latest) return seasonClock(seasonStartsAt.getTime(), timing)
  return { anchor: savedWindow(latest, timing), timing }
}

/** The times of spin `spin` on this schedule, or null for a spin before its anchor. */
export function windowOf(clock: RouletteClock, spin: number): SpinWindow | null {
  const { anchor, timing } = clock
  if (spin === anchor.spin) return anchor
  if (spin < anchor.spin) return null
  const cycle = timing.bettingMs + timing.spinMs + timing.resultMs
  return spinWindow(spin, anchor.endsAt + (spin - anchor.spin - 1) * cycle, timing)
}

export type ResolvedBets =
  | { ok: true; bets: { spot: string; amount: bigint }[]; total: bigint }
  | { ok: false; error: string }

/**
 * Turns typed bets into chips, in order, each against what is left in the
 * wallet once the bets before it are down: "all red" after "10 black" bets
 * the rest. Each bet must pass the bet limits on its own (min_bet, and
 * max_bet_pct of the wallet as it stands).
 */
export function resolveBets(
  bets: readonly { spot: string; bet: string }[],
  balance: bigint,
  limits: BetLimits,
): ResolvedBets {
  let left = balance
  const resolved: { spot: string; amount: bigint }[] = []
  for (const { spot, bet } of bets) {
    const parsed = parseBetAmount(bet, left, limits)
    if (!parsed.ok) return parsed
    const problem = checkBetAmount(parsed.amount, left, limits)
    if (problem) {
      return { ok: false, error: bets.length > 1 ? `${spotById(spot).name}: ${problem}` : problem }
    }
    resolved.push({ spot, amount: parsed.amount })
    left -= parsed.amount
  }
  return { ok: true, bets: resolved, total: balance - left }
}
