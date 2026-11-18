/**
 * Every chip movement is one ledger row with one of these reasons (spec:
 * Economy > Wallet). Adding a reason is a shared change: ask the foundation
 * owner instead of inventing one in a lane.
 */
export const LEDGER_REASONS = [
  'season_start',
  'bet',
  'payout',
  'refund',
  'daily_bonus',
  'challenge',
  'rebuy',
  'steal_in',
  'steal_out',
  'fine_in',
  'fine_out',
  'shield_purchase',
  'vault_deposit',
  'vault_withdraw',
  'admin_adjust',
  // Added Nov 18, 2026 for Ranks, Giveaways and the Shop. The streak bonus
  // keeps `daily_bonus`.
  'rank_purchase',
  'rank_income',
  'chat_drop',
  'giveaway',
  'steal_attempt_purchase',
] as const

export type LedgerReason = (typeof LEDGER_REASONS)[number]

/** A player's chips live in two accounts. Net worth is both added together. */
export const LEDGER_ACCOUNTS = ['wallet', 'vault'] as const
export type LedgerAccount = (typeof LEDGER_ACCOUNTS)[number]
