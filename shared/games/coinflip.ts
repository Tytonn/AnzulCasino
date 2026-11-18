/**
 * Coin flip, the reference game (spec: Build plan, deliverable 10): call
 * heads or tails, and a win pays twice the bet less the house edge. The rules
 * the browser and the server share live here; the flip itself happens on the
 * server, at the moment it is revealed (rule 7, draw late).
 */
import { z } from 'zod'

import { mulDiv } from '../chips.ts'
import { BetText } from '../rounds.ts'

export const COINFLIP = 'coinflip'

export const SIDES = ['heads', 'tails'] as const
export type Side = (typeof SIDES)[number]

export const SIDE_NAMES: Record<Side, string> = { heads: 'Heads', tails: 'Tails' }

/** POST /api/coinflip/play */
export const CoinflipPlayInput = z.strictObject({
  bet: BetText,
  call: z.enum(SIDES, { error: 'Call heads or tails.' }),
})
export type CoinflipPlayInput = z.infer<typeof CoinflipPlayInput>

/** A coin flip round's public detail: enough to draw it and to replay it. */
export interface CoinflipDetail {
  /** The side the player called. */
  call: Side
  /** The side that landed. Null only in the moment between the bet and the flip. */
  face: Side | null
  /** The house edge when the bet was placed, in basis points. */
  edgePct: number
}

/** What a win pays per unit staked, in hundredths: 196 is 1.96x at a 2% edge. */
export function winMultiplier(edgePct: number): number {
  return Math.floor((2 * (10_000 - edgePct)) / 100)
}

/** The payout for a flip: twice the stake less the edge on a win, rounded down; nothing on a loss. */
export function coinflipPayout(stake: bigint, won: boolean, edgePct: number): bigint {
  if (!won) return 0n
  return mulDiv(stake, BigInt(2 * (10_000 - edgePct)), 10_000n)
}
