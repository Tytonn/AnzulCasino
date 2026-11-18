/** Every round of every game moves through these states (spec: The room model). */
export const ROUND_STATUSES = ['open', 'settled', 'void'] as const
export type RoundStatus = (typeof ROUND_STATUSES)[number]
