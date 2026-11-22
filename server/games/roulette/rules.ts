/**
 * Roulette's rules engine: the draw and turning typed bets into chips. The
 * table's spots and payouts are shared with the browser
 * (shared/games/roulette.ts); the number itself is server randomness only.
 */
import { type BetLimits, checkBetAmount, parseBetAmount } from '../../../shared/bet-amount.ts'
import { POCKETS, spotById } from '../../../shared/games/roulette.ts'
import { randomBelow } from '../../lib/rng.ts'

/**
 * Draws the winning number: 0 to 36, each with odds of 1 in 37, from
 * node:crypto's randomInt (no modulo bias). Called only once betting has
 * closed (rule 7, draw late).
 */
export function drawNumber(): number {
  return randomBelow(POCKETS)
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
