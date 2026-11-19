/**
 * Coin flip's rules engine. The payout math is shared with the browser
 * (shared/games/coinflip.ts); the flip itself is server randomness only.
 */
import { SIDES, type Side } from '../../../shared/games/coinflip.ts'
import { pick } from '../../lib/rng.ts'

/** Flips the coin: heads or tails, even odds, from node:crypto. */
export function flip(): Side {
  return pick(SIDES)
}
