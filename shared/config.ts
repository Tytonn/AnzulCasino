/**
 * Every tunable number (spec rule 9): its default, its unit and a one-line
 * description. This is the one defaults file. The `config` table holds only
 * the changes the admin made, each with the moment it takes effect, and the
 * server reads the result through loadConfig() in server/lib/config.ts.
 *
 * Units:
 * - `chips`: hundredths of a chip, bigint in code. `min_bet` 100n is 1 chip.
 * - `share`: basis points, where 100 is 1% and 10,000 is 100%. Every `_pct`
 *   and `_rate` key is a share. Use basisPoints() and formatShare() from
 *   shared/chips.ts.
 * - everything else: a whole number in the unit its name ends with.
 *
 * On the wire and in the table, every value is a plain number (chips as
 * hundredths).
 *
 * Changes to the economy, ranks, giveaways, steals, shields and the vault
 * take effect at the next daily reset; the rest take effect at once (spec:
 * Admin and trust). Adding a key is a shared change: ask the foundation
 * owner, as for a ledger reason.
 *
 * Absolute chip amounts are the spec's values after Tyton's 1/100 rebalance
 * (starting balance 100). Values marked provisional have no number in the
 * spec yet; the owning lane tunes them with the season simulation.
 */
import { CHIP, chipCount, formatShare } from './chips.ts'
import type { Tier } from './tiers.ts'

export const CONFIG_GROUPS = [
  'seasons',
  'economy',
  'ranks',
  'giveaways',
  'steals',
  'shields',
  'vault',
  'games',
  'social',
] as const
export type ConfigGroup = (typeof CONFIG_GROUPS)[number]

/** Groups whose changes wait for the next daily reset. */
export const DELAYED_GROUPS: readonly ConfigGroup[] = [
  'economy',
  'ranks',
  'giveaways',
  'steals',
  'shields',
  'vault',
]

type NumberUnit = 'share' | 'count' | 'seconds' | 'minutes' | 'hours' | 'days' | 'times'

interface SettingBase {
  group: ConfigGroup
  description: string
  /** No number in the spec yet: the owning lane tunes it. */
  provisional?: true
}

export interface ChipsSetting extends SettingBase {
  unit: 'chips'
  default: bigint
  min: bigint
  max: bigint
}

export interface NumberSetting extends SettingBase {
  unit: NumberUnit
  default: number
  min: number
  max: number
}

export type ConfigSetting = ChipsSetting | NumberSetting

/** A billion chips: far above any sane setting, far below the wire's safe-integer limit. */
const MAX_CHIPS = 1_000_000_000n * CHIP

interface Options {
  min?: number
  max?: number
  provisional?: true
}

/** A chip amount, given in whole chips. */
function chips(
  group: ConfigGroup,
  whole: number,
  description: string,
  options: Options = {},
): ChipsSetting {
  return {
    unit: 'chips',
    group,
    default: BigInt(whole) * CHIP,
    min: BigInt(options.min ?? 0) * CHIP,
    max: options.max === undefined ? MAX_CHIPS : BigInt(options.max) * CHIP,
    description,
    ...(options.provisional ? { provisional: true } : {}),
  }
}

/** A share in basis points: share('steals', 150, ...) is 1.5%. */
function share(
  group: ConfigGroup,
  basisPoints: number,
  description: string,
  options: Options = {},
): NumberSetting {
  return number(group, 'share', basisPoints, description, { min: 0, max: 10_000, ...options })
}

function number(
  group: ConfigGroup,
  unit: NumberUnit,
  value: number,
  description: string,
  options: Options = {},
): NumberSetting {
  return {
    unit,
    group,
    default: value,
    min: options.min ?? 0,
    max: options.max ?? 1_000_000,
    description,
    ...(options.provisional ? { provisional: true } : {}),
  }
}

export const CONFIG = {
  // Seasons
  starting_balance: chips(
    'seasons',
    100,
    'Chips each player gets when a season starts, or when they join late. Each new season copies it.',
    { min: 1 },
  ),
  final_freeze_hours: number(
    'seasons',
    'hours',
    24,
    'Hours before the season ends when steals, shields, vault moves and rank purchases stop.',
    { max: 168 },
  ),

  // Economy
  streak_step: chips(
    'economy',
    1,
    'Streak bonus added for each game day in a row a player collects. A missed day resets it.',
  ),
  streak_max: chips('economy', 10, 'Most the streak bonus can grow to.'),
  challenges_per_day: number('economy', 'count', 3, 'Challenges each player gets per game day.', {
    max: 10,
  }),
  challenge_reward_min: chips('economy', 2, 'Smallest reward for finishing a challenge.'),
  challenge_reward_max: chips('economy', 4, 'Largest reward for finishing a challenge.'),
  rebuy_amount: chips('economy', 5, 'Chips a broke player can claim once per game day.'),
  rebuy_below: chips('economy', 3, 'A player whose net worth is under this can claim the rebuy.'),

  // Ranks (tiers in code). Unlock days count from 1, the season's first game day.
  tier_income_cap_hours: number(
    'ranks',
    'hours',
    24,
    'Uncollected rank income stops growing after this many hours.',
    { min: 1, max: 720 },
  ),
  tier_base_income: chips('ranks', 5, 'Base rank: income per day.'),
  tier_bronze_price: chips('ranks', 150, 'Bronze rank: price.'),
  tier_bronze_income: chips('ranks', 15, 'Bronze rank: income per day.'),
  tier_bronze_unlock_day: number(
    'ranks',
    'days',
    1,
    'Bronze rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_silver_price: chips('ranks', 1_000, 'Silver rank: price.'),
  tier_silver_income: chips('ranks', 100, 'Silver rank: income per day.'),
  tier_silver_unlock_day: number(
    'ranks',
    'days',
    3,
    'Silver rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_gold_price: chips('ranks', 10_000, 'Gold rank: price.'),
  tier_gold_income: chips('ranks', 1_000, 'Gold rank: income per day.'),
  tier_gold_unlock_day: number(
    'ranks',
    'days',
    6,
    'Gold rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_platinum_price: chips('ranks', 100_000, 'Platinum rank: price.'),
  tier_platinum_income: chips('ranks', 10_000, 'Platinum rank: income per day.'),
  tier_platinum_unlock_day: number(
    'ranks',
    'days',
    10,
    'Platinum rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_diamond_price: chips('ranks', 1_000_000, 'Diamond rank: price.'),
  tier_diamond_income: chips('ranks', 100_000, 'Diamond rank: income per day.'),
  tier_diamond_unlock_day: number(
    'ranks',
    'days',
    14,
    'Diamond rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_crown_price: chips('ranks', 10_000_000, 'Crown rank: price.'),
  tier_crown_income: chips('ranks', 1_000_000, 'Crown rank: income per day.'),
  tier_crown_unlock_day: number(
    'ranks',
    'days',
    18,
    'Crown rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),

  // Giveaways
  chat_drop_every_minutes: number(
    'giveaways',
    'minutes',
    90,
    'Average time between chat drops while players are online.',
    { min: 1, provisional: true },
  ),
  chat_drop_pot: chips('giveaways', 10, 'Chips in each chat drop, split between its winners.', {
    provisional: true,
  }),
  chat_drop_winners: number('giveaways', 'count', 3, 'Players who can claim each chat drop.', {
    min: 1,
    max: 10,
    provisional: true,
  }),

  // Steals
  steal_attempts_per_day: number(
    'steals',
    'count',
    2,
    'Free steal attempts per player per game day.',
    { max: 20 },
  ),
  steal_success_pct: share('steals', 5_500, 'Chance an unshielded steal works.'),
  steal_base_rate: share(
    'steals',
    150,
    "Share of the target's wallet taken at the smallest rank gap.",
  ),
  steal_per_rank: share('steals', 30, 'Added to the rate for each place the target is ahead.'),
  steal_max_rate: share(
    'steals',
    400,
    "Most one steal can take, as a share of the target's wallet.",
  ),
  steal_down_rate: share('steals', 50, 'Rate when robbing someone ranked below you.'),
  daily_loss_cap_pct: share(
    'steals',
    400,
    'Most of their net worth at the daily reset a player can lose to steals in one game day.',
  ),
  steal_fine_pct: share(
    'steals',
    500,
    "Share of the thief's wallet paid to the target when a steal fails.",
  ),
  immunity_hours: number(
    'steals',
    'hours',
    3,
    'Immunity after being robbed or after a shield blocks a steal.',
    { max: 72 },
  ),
  steal_floor: chips('steals', 25, 'Players with less net worth than this cannot be robbed.'),
  extra_steal_price_pct: share(
    'steals',
    200,
    "Price of the one extra steal attempt per game day, as a share of the buyer's wallet.",
    { provisional: true },
  ),
  extra_steal_price_min: chips('steals', 3, 'Lowest price of the extra steal attempt.', {
    provisional: true,
  }),

  // Shields
  shield_max_charges: number('shields', 'count', 2, 'Most shield charges a player can hold.', {
    max: 10,
  }),
  shield_weekly_limit: number(
    'shields',
    'count',
    3,
    'Most shield charges a player can buy per season week.',
    { max: 20 },
  ),
  shield_price_pct: share(
    'shields',
    200,
    "Price of a shield charge, as a share of the buyer's wallet.",
  ),
  shield_price_min: chips('shields', 3, 'Lowest price of a shield charge.'),

  // Vault
  vault_cap_pct: share(
    'vault',
    2_500,
    "Most of a player's net worth the vault can hold, checked at deposit.",
  ),

  // Games
  min_bet: chips('games', 1, 'Smallest bet in any game.', { min: 0 }),
  max_bet_pct: share('games', 10_000, 'Largest bet as a share of the wallet. 100% allows all-in.', {
    min: 1,
  }),
  big_bet_pct: share(
    'games',
    5_000,
    'A bet at or above this share of net worth is flagged as a big bet in the room.',
    { min: 1 },
  ),
  round_timeout_minutes: number(
    'games',
    'minutes',
    10,
    'An open round left this long is finished by its safest rule: blackjack stands, mines cashes out.',
    { min: 1, max: 1_440, provisional: true },
  ),
  roulette_betting_seconds: number(
    'games',
    'seconds',
    20,
    'Roulette: seconds of betting in each round.',
    { min: 5, max: 300 },
  ),
  roulette_spin_seconds: number('games', 'seconds', 7, 'Roulette: seconds the wheel spins.', {
    min: 1,
    max: 60,
  }),
  roulette_result_seconds: number(
    'games',
    'seconds',
    3,
    'Roulette: seconds the result shows before the next round.',
    { min: 1, max: 60 },
  ),
  mines_edge_pct: share('games', 200, 'Mines house edge.', { max: 2_000 }),
  plinko_edge_pct: share('games', 200, 'Plinko house edge.', { max: 2_000 }),
  crash_edge_pct: share('games', 300, 'Crash house edge.', { max: 2_000 }),
  crash_betting_seconds: number(
    'games',
    'seconds',
    10,
    'Crash: seconds of betting before the multiplier starts climbing.',
    { min: 3, max: 120, provisional: true },
  ),
  crash_max_multiplier: number(
    'games',
    'times',
    1_000,
    'Crash: the highest multiplier a round can reach.',
    { min: 2, max: 1_000_000 },
  ),
  slots_edge_pct: share('games', 400, 'Slots house edge. The target return is 100% minus this.', {
    max: 2_000,
  }),

  // Social
  chat_burst_count: number(
    'social',
    'count',
    5,
    'Chat messages a player can send per chat window.',
    { min: 1, max: 100 },
  ),
  chat_burst_seconds: number('social', 'seconds', 10, 'Length of the chat window.', {
    min: 1,
    max: 3_600,
  }),
  away_minutes: number(
    'social',
    'minutes',
    5,
    'Players show as away after this long without input.',
    { min: 1, max: 120 },
  ),
} satisfies Record<string, ConfigSetting>

export type ConfigKey = keyof typeof CONFIG

/** Every config value, typed: bigint for chips, number for the rest. */
export type ConfigValues = {
  [K in ConfigKey]: (typeof CONFIG)[K] extends ChipsSetting ? bigint : number
}

export const CONFIG_KEYS = Object.keys(CONFIG) as ConfigKey[]

export function isConfigKey(key: string): key is ConfigKey {
  return Object.hasOwn(CONFIG, key)
}

export function setting(key: ConfigKey): ConfigSetting {
  return CONFIG[key]
}

/** True when a change to `key` waits for the next daily reset. */
export function waitsForReset(key: ConfigKey): boolean {
  return DELAYED_GROUPS.includes(setting(key).group)
}

/** Every default, typed. */
export function configDefaults(): ConfigValues {
  const values: Record<string, bigint | number> = {}
  for (const key of CONFIG_KEYS) values[key] = setting(key).default
  return values as ConfigValues
}

export type ParsedValue = { ok: true; value: bigint | number } | { ok: false; error: string }

/**
 * Checks a value in its wire form (a plain number; chips as hundredths)
 * against the key's unit and limits.
 */
export function parseConfigValue(key: ConfigKey, raw: unknown): ParsedValue {
  const s = setting(key)
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    return { ok: false, error: `${key} must be a whole number.` }
  }
  if (s.unit === 'chips') {
    const value = BigInt(raw)
    if (value < s.min || value > s.max) {
      return {
        ok: false,
        error: `${key} must be between ${chipCount(s.min)} and ${chipCount(s.max)}.`,
      }
    }
    return { ok: true, value }
  }
  if (raw < s.min || raw > s.max) {
    return {
      ok: false,
      error: `${key} must be between ${formatValue(s, s.min)} and ${formatValue(s, s.max)}.`,
    }
  }
  return { ok: true, value: raw }
}

function formatValue(s: ConfigSetting, value: bigint | number): string {
  if (s.unit === 'chips') return chipCount(BigInt(value))
  const n = Number(value)
  switch (s.unit) {
    case 'share':
      return formatShare(n)
    case 'times':
      return `${n}x`
    case 'count':
      return String(n)
    default:
      return `${n} ${n === 1 ? s.unit.slice(0, -1) : s.unit}`
  }
}

/** A value for people: "100 chips", "1.5%", "3 hours", "1000x". */
export function formatConfigValue(key: ConfigKey, value: bigint | number): string {
  return formatValue(setting(key), value)
}

export interface TierSettings {
  /** Hundredths. Zero for the base tier. */
  price: bigint
  /** Hundredths per day. */
  income: bigint
  /** First season day it can be bought. Zero for the base tier, which everyone has. */
  unlockDay: number
}

/** A tier's price, income and unlock day from the config. */
export function tierSettings(values: ConfigValues, tier: Tier): TierSettings {
  if (tier === 'base') return { price: 0n, income: values.tier_base_income, unlockDay: 0 }
  return {
    price: values[`tier_${tier}_price`],
    income: values[`tier_${tier}_income`],
    unlockDay: values[`tier_${tier}_unlock_day`],
  }
}
