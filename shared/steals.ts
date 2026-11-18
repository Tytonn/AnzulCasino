export const STEAL_OUTCOMES = ['success', 'failed', 'blocked'] as const
export type StealOutcome = (typeof STEAL_OUTCOMES)[number]
