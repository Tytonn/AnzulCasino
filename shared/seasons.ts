export const SEASON_STATUSES = ['scheduled', 'active', 'final_day', 'ended'] as const
export type SeasonStatus = (typeof SEASON_STATUSES)[number]
