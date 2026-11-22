/**
 * What .roulette reads after its word (spec: Games > Roulette > Spaces):
 * "<amount> <space>", such as 50 red, 600 2nd or all 17, or several split by
 * commas (50 red, 25 17), where a place without an amount takes the one
 * before it. Pure, so the unit tests read it directly; the server resolves
 * each amount against the wallet.
 */
import { parseQuickBet, type QuickBet, spotById } from '../../../shared/games/roulette.ts'

/** One bet to place: the amount as typed ("50", "half", "all", "2.5k") and the spot. */
export interface BetToPlace {
  amount: string
  spot: string
}

/**
 * The typed bets with an amount each: a place typed without one takes the
 * amount before it in the line ("50 red, 17" is 50 on each). Null when the
 * first has none.
 */
export function withAmounts(bets: readonly QuickBet[]): BetToPlace[] | null {
  const out: BetToPlace[] = []
  let amount: string | null = null
  for (const bet of bets) {
    amount = bet.amount ?? amount
    if (amount === null) return null
    out.push({ amount, spot: bet.spot })
  }
  return out
}

/** The bets typed after the word, or why they cannot be placed. `called` is the word as typed: ".rl". */
export function readBets(
  args: string,
  called: string,
): { ok: true; bets: BetToPlace[] } | { ok: false; error: string } {
  if (!args.trim()) {
    return { ok: false, error: `${called} needs a bet and a place, like ${called} 50 red.` }
  }
  const parsed = parseQuickBet(args)
  if (!parsed.ok) return parsed
  if ('amount' in parsed) {
    return {
      ok: false,
      error: `Say where it goes, like ${called} ${parsed.amount.toLowerCase()} red.`,
    }
  }
  const bets = withAmounts(parsed.bets)
  if (!bets) {
    // A spot's id always reads back as its place: "red", "17", "1st12", "col1".
    const spot = parsed.bets[0]?.spot ?? 'red'
    const name = spotById(spot).name
    return { ok: false, error: `Say how much goes on ${name}, like ${called} 50 ${spot}.` }
  }
  return { ok: true, bets }
}
