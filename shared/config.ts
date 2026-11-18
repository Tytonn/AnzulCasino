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
 * - `text`: one short plain-text name, such as a button's label.
 * - `lines`: a list of short plain-text lines, such as the flavor lines
 *   shown with a work or crime result.
 * - everything else: a whole number in the unit its name ends with.
 *
 * On the wire and in the table, every value is a plain number (chips as
 * hundredths), except `text`, a string, and `lines`, an array of strings.
 *
 * Changes to the economy, ranks, giveaways, steals, shields and the vault
 * take effect at the next daily reset; the rest take effect at once (spec:
 * Admin and trust). Adding a key is a shared change: ask the foundation
 * owner, as for a ledger reason.
 *
 * A `_min` and `_max` pair is listed in CONFIG_PAIRS, and a change that
 * would put the minimum above the maximum is refused.
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
  'text',
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

export interface TextSetting extends SettingBase {
  unit: 'text'
  default: string
  /** Longest name, in characters. */
  maxLength: number
}

export interface LinesSetting extends SettingBase {
  unit: 'lines'
  default: readonly string[]
  /** Most lines the list may hold. It always holds at least one. */
  maxLines: number
  /** Longest line, in characters. */
  maxLength: number
}

export type ConfigSetting = ChipsSetting | NumberSetting | TextSetting | LinesSetting

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

/** A short plain-text name, such as a button label. Up to 20 characters. */
function text(group: ConfigGroup, value: string, description: string): TextSetting {
  return { unit: 'text', group, default: value, maxLength: 20, description }
}

/** Plain-text lines, such as flavor text. Up to 100 lines of up to 120 characters. */
function lines(
  group: ConfigGroup,
  value: readonly string[],
  description: string,
  options: Pick<Options, 'provisional'> = {},
): LinesSetting {
  return {
    unit: 'lines',
    group,
    default: value,
    maxLines: 100,
    maxLength: 120,
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

  // Work, the third command and crime (spec: Economy > Work and crime), at
  // Tyton's final values. They replace the rebuy. The longer the cooldown,
  // the bigger and riskier the single payout.
  work_cooldown_minutes: number(
    'economy',
    'minutes',
    5,
    'Minutes between presses of the work button.',
    { min: 1, max: 1_440 },
  ),
  work_pay_min: chips('economy', 2, 'Least a press of the work button pays.'),
  work_pay_max: chips('economy', 6, 'Most a press of the work button pays.'),
  crime_cooldown_minutes: number('economy', 'minutes', 120, 'Minutes between crimes.', {
    min: 1,
    max: 1_440,
  }),
  crime_success_pct: share('economy', 4_500, 'Chance a crime pays instead of ending in a fine.'),
  crime_pay_min: chips('economy', 60, 'Least a crime that works pays.'),
  crime_pay_max: chips('economy', 150, 'Most a crime that works pays.'),
  crime_fine_min: chips(
    'economy',
    10,
    'Smallest fine for a failed crime. A fine never takes the wallet below zero.',
  ),
  crime_fine_max: chips('economy', 30, 'Largest fine for a failed crime.'),
  crime_chat_min: chips(
    'economy',
    140,
    'A crime payout of at least this posts a short line in chat. No other work or crime result does.',
  ),
  // The third command, after UnbelievaBoat's .slut: `hustle` in code, and its
  // button's name is the hustle_name setting.
  hustle_cooldown_minutes: number(
    'economy',
    'minutes',
    60,
    'Minutes between presses of the third income button.',
    { min: 1, max: 1_440 },
  ),
  hustle_success_pct: share(
    'economy',
    6_500,
    'Chance the third income button pays instead of ending in a fine.',
  ),
  hustle_pay_min: chips('economy', 20, 'Least the third income button pays when it works.'),
  hustle_pay_max: chips('economy', 50, 'Most the third income button pays when it works.'),
  hustle_fine_min: chips(
    'economy',
    5,
    'Smallest fine from the third income button. A fine never takes the wallet below zero.',
  ),
  hustle_fine_max: chips('economy', 15, 'Largest fine from the third income button.'),

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
  russian_roulette_join_seconds: number(
    'games',
    'seconds',
    20,
    'Russian roulette: seconds other players have to join a lobby at its ante.',
    { min: 5, max: 120 },
  ),
  russian_roulette_turn_seconds: number(
    'games',
    'seconds',
    10,
    'Russian roulette: seconds a player has to pull before the trigger pulls itself.',
    { min: 3, max: 60 },
  ),
  russian_roulette_solo_edge_pct: share(
    'games',
    200,
    'Russian roulette: house edge in the solo game, when nobody joins.',
    { max: 2_000 },
  ),
  russian_roulette_ante_cap_pct: share(
    'games',
    2_000,
    "Russian roulette: largest ante as a share of the player's net worth, so two players cannot pass chips to each other.",
    { min: 1 },
  ),
  race_betting_seconds: number(
    'games',
    'seconds',
    45,
    'Race: seconds of betting before each race.',
    {
      min: 5,
      max: 300,
      provisional: true,
    },
  ),
  race_running_seconds: number('games', 'seconds', 20, 'Race: seconds the race takes to run.', {
    min: 5,
    max: 120,
    provisional: true,
  }),
  race_result_seconds: number(
    'games',
    'seconds',
    10,
    'Race: seconds the result shows before betting opens again.',
    { min: 1, max: 60, provisional: true },
  ),
  race_edge_pct: share('games', 500, 'Race house edge, carried by the posted odds.', {
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

  // Names and lines shown to players: plain text, edited in the admin panel,
  // taking effect at once. The line pools are starters: the economy lane
  // writes the full ones.
  hustle_name: text('text', 'Slut', "The third income button's name, after UnbelievaBoat's .slut."),
  work_lines: lines(
    'text',
    [
      'You folded towels at the spa all afternoon.',
      'You parked cars for the high rollers.',
      'You polished every slot machine on the floor.',
      'You ran drinks to the poker room.',
      'You counted coins in the back office.',
      'You swept up the confetti after a big win.',
      'You dealt a few hands while the dealer took a break.',
      "You walked the owner's very large dog.",
      'You fixed the sign so it says ANZUL again.',
      'You handed out flyers on the boardwalk.',
    ],
    'Work: one line is picked at random to show with each payout.',
    { provisional: true },
  ),
  crime_win_lines: lines(
    'text',
    [
      'You ran a game of three-card monte, and the tourist never found the queen.',
      "You sold a tourist a 'lucky' horseshoe.",
      'You found a chip under the craps table and kept quiet.',
      'You hustled the regulars at the pool table.',
      'You talked your way into the VIP buffet and sold the shrimp.',
      'You picked the vending machine lock on the first try.',
      'You sold fake tickets to the magic show.',
      'You swapped the dice and nobody noticed.',
    ],
    'Crime: one line is picked at random to show with a crime that pays.',
    { provisional: true },
  ),
  crime_fine_lines: lines(
    'text',
    [
      'Security caught you counting cards on your fingers.',
      'The tourist was an undercover cop.',
      'You tripped over the velvet rope on the way out.',
      'The vending machine kept your coins and called the manager.',
      'Your fake mustache fell off halfway through.',
      'The pit boss watched the whole thing on camera.',
      'You got lost in the parking garage and paid for three hours.',
      'Your getaway driver left without you.',
    ],
    'Crime: one line is picked at random to show with a fine.',
    { provisional: true },
  ),
  hustle_win_lines: lines(
    'text',
    [
      'You danced on the bar and the tips came raining down.',
      'You winked at the high roller and he paid for the wink.',
      'You sold your phone number to three different tourists.',
      'You worked the VIP lounge in your best outfit.',
    ],
    'Third income button: one line is picked at random to show when it pays. The economy lane writes the full pool of at least 40, joke-level and suggestive at most.',
    { provisional: true },
  ),
  hustle_fine_lines: lines(
    'text',
    [
      'You tripped in your heels in front of the whole casino.',
      'Your date turned out to be the pit boss.',
      'Security walked you out of the VIP lounge.',
      'You spent more on the outfit than you made.',
    ],
    'Third income button: one line is picked at random to show with a fine.',
    { provisional: true },
  ),
} satisfies Record<string, ConfigSetting>

/**
 * Settings that come as a range. A change that would put a minimum above its
 * maximum is refused, so game code can draw from the range without checking.
 */
export const CONFIG_PAIRS = [
  ['challenge_reward_min', 'challenge_reward_max'],
  ['work_pay_min', 'work_pay_max'],
  ['crime_pay_min', 'crime_pay_max'],
  ['crime_fine_min', 'crime_fine_max'],
  ['hustle_pay_min', 'hustle_pay_max'],
  ['hustle_fine_min', 'hustle_fine_max'],
] as const satisfies readonly (readonly [ConfigKey, ConfigKey])[]

export type ConfigKey = keyof typeof CONFIG

/** A config value in code: bigint for chips, a string for text, a list for lines, number for the rest. */
export type ConfigValue = bigint | number | string | readonly string[]

/** Every config value, typed. */
export type ConfigValues = {
  [K in ConfigKey]: (typeof CONFIG)[K] extends ChipsSetting
    ? bigint
    : (typeof CONFIG)[K] extends TextSetting
      ? string
      : (typeof CONFIG)[K] extends LinesSetting
        ? readonly string[]
        : number
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
  const values: Record<string, ConfigValue> = {}
  for (const key of CONFIG_KEYS) values[key] = setting(key).default
  return values as ConfigValues
}

export type ParsedValue = { ok: true; value: ConfigValue } | { ok: false; error: string }

// Control characters, which have no place in a line shown to players.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

function parseText(key: ConfigKey, s: TextSetting, raw: unknown): ParsedValue {
  if (typeof raw !== 'string') return { ok: false, error: `${key} must be text.` }
  const value = raw.trim()
  if (!value || value.length > s.maxLength) {
    return { ok: false, error: `${key} must be 1 to ${s.maxLength} characters.` }
  }
  if (CONTROL_CHARACTERS.test(value)) {
    return { ok: false, error: `${key} must be plain text on one line.` }
  }
  return { ok: true, value }
}

function parseLines(key: ConfigKey, s: LinesSetting, raw: unknown): ParsedValue {
  if (!Array.isArray(raw) || raw.some((line) => typeof line !== 'string')) {
    return { ok: false, error: `${key} must be a list of lines.` }
  }
  const value = (raw as string[]).map((line) => line.trim())
  if (value.length === 0 || value.length > s.maxLines) {
    return { ok: false, error: `${key} needs between 1 and ${s.maxLines} lines.` }
  }
  for (const line of value) {
    if (!line) return { ok: false, error: `${key} cannot have an empty line.` }
    if (line.length > s.maxLength) {
      return { ok: false, error: `Each line of ${key} must be ${s.maxLength} characters or fewer.` }
    }
    if (CONTROL_CHARACTERS.test(line)) {
      return { ok: false, error: `${key} must be plain text on one line each.` }
    }
  }
  return { ok: true, value }
}

/**
 * Checks a value in its wire form (a plain number with chips as hundredths, a
 * string for text, or a list of strings for lines) against the key's unit and
 * limits.
 */
export function parseConfigValue(key: ConfigKey, raw: unknown): ParsedValue {
  const s = setting(key)
  if (s.unit === 'text') return parseText(key, s, raw)
  if (s.unit === 'lines') return parseLines(key, s, raw)
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

function formatValue(s: ConfigSetting, value: ConfigValue): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object') return value.length === 1 ? '1 line' : `${value.length} lines`
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

/** A value for people: "100 chips", "1.5%", "3 hours", "1000x", "8 lines". */
export function formatConfigValue(key: ConfigKey, value: ConfigValue): string {
  return formatValue(setting(key), value)
}

/** The value as it travels and is stored: chips as a number of hundredths. */
export function configWireValue(value: ConfigValue): number | string | string[] {
  if (typeof value === 'string') return value
  return typeof value === 'object' ? [...value] : Number(value)
}

/**
 * The pair a key belongs to, if any, as [minimum key, maximum key]. changeConfig
 * uses it to refuse a minimum above its maximum.
 */
export function configPair(key: ConfigKey): readonly [ConfigKey, ConfigKey] | undefined {
  return CONFIG_PAIRS.find(([min, max]) => min === key || max === key)
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
