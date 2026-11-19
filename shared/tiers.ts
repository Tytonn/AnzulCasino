/**
 * The purchasable Ranks from the spec (Economy > Ranks). In code they are
 * tiers, because "rank" already means a player's place on the leaderboard.
 * Prices, income and unlock days are config values; the economy lane owns
 * the rules. This list only fixes the names and their order.
 */
export const TIERS = ['base', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'crown'] as const
export type Tier = (typeof TIERS)[number]

export const TIER_LABELS: Record<Tier, string> = {
  base: 'Base',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
  crown: 'Crown',
}

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value)
}
