/**
 * Steal attempts as everyone sees them (spec: Steal, shields and vault). The
 * heist lane's rules and endpoints build on these; the ticker shows them
 * (Steal rules, rule 7), so the shell and the `steal.result` event share them.
 */
export const STEAL_OUTCOMES = ['success', 'failed', 'blocked'] as const
export type StealOutcome = (typeof STEAL_OUTCOMES)[number]

/** One steal attempt as the API, the ticker and the `steal.result` event send it. Amounts in chips. */
export interface StealView {
  id: number
  seasonId: number
  thiefId: string
  targetId: string
  /** The game day it counts toward (YYYY-MM-DD). */
  gameDay: string
  outcome: StealOutcome
  /** Moved from the target's wallet to the thief's, on a success. */
  amount: number
  /** Paid by the thief to the target, on a failure. */
  fine: number
  thiefRank: number
  targetRank: number
  createdAt: string
}

/** The `steal.result` feed event: the attempt, and the target's immunity it started. */
export interface StealResult extends StealView {
  /** When the target's immunity ends, after a success or a block. */
  immuneUntil: string | null
}
