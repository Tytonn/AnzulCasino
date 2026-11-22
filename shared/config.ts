/**
 * Every tunable number (spec rule 9): its default, its unit and a one-line
 * description. This is the one defaults file. The `config` table holds only
 * the changes the admin made, each with the moment it takes effect, and the
 * server reads the result through loadConfig() in server/lib/config.ts.
 *
 * Units:
 * - `chips`: whole chips, bigint in code. `min_bet` 25n is 25 chips.
 * - `share`: basis points, where 100 is 1% and 10,000 is 100%. Every `_pct`
 *   and `_rate` key is a share. Use basisPoints() and formatShare() from
 *   shared/chips.ts.
 * - `text`: one short plain-text name, such as a button's label.
 * - `lines`: a list of short plain-text lines, such as the flavor lines
 *   shown with a work or crime result.
 * - `choice`: one of a few named options, such as `fold` or `separate`.
 * - `words`: a command's words, typed after the prefix: its name first,
 *   then its aliases. No word belongs to two commands.
 * - everything else: a whole number in the unit its name ends with.
 *
 * On the wire and in the table, every value is a plain number (chips as
 * whole chips), except `text` and `choice`, a string, and `lines` and
 * `words`, an array of strings.
 *
 * Changes to the economy, ranks, giveaways, steals, shields and the vault
 * take effect at the next daily reset; the rest take effect at once (spec:
 * Admin and trust). Adding a key is a shared change: ask the foundation
 * owner, as for a ledger reason.
 *
 * A `_min` and `_max` pair is listed in CONFIG_PAIRS, and a change that
 * would put the minimum above the maximum is refused.
 *
 * Absolute chip amounts are the spec's values at Tyton's scale of Nov 22, 2026
 * (starting balance 1,000): ten times the 1/100 rebalance of Nov 18. Values
 * marked provisional have no number in the spec yet; the owning lane tunes
 * them with the season simulation.
 */
import { CHIP, chipCount, formatShare } from './chips.ts'
import {
  CRIME_FINE_LINES,
  CRIME_WIN_LINES,
  HUSTLE_FINE_LINES,
  HUSTLE_WIN_LINES,
  WORK_LINES,
} from './config-lines.ts'
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
  'commands',
  'stream',
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

type NumberUnit =
  'share' | 'count' | 'milliseconds' | 'seconds' | 'minutes' | 'hours' | 'days' | 'times'

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
  /** Symbols only: no letters, digits, spaces or @. The command prefix. */
  symbolsOnly?: true
}

export interface LinesSetting extends SettingBase {
  unit: 'lines'
  default: readonly string[]
  /** Most lines the list may hold. It always holds at least one. */
  maxLines: number
  /** Longest line, in characters. */
  maxLength: number
}

export interface ChoiceOption<V extends string = string> {
  /** What is stored and what code compares. */
  value: V
  /** What the admin panel shows. */
  label: string
}

export interface ChoiceSetting<V extends string = string> extends SettingBase {
  unit: 'choice'
  default: V
  /** Two or more options. */
  options: readonly ChoiceOption<V>[]
}

export interface WordsSetting extends SettingBase {
  unit: 'words'
  /** The command's name in the command list, such as "Blackjack". */
  label: string
  /** Its name first, then its aliases. */
  default: readonly string[]
  /** Most words the list may hold. It always holds at least one. */
  maxWords: number
  /** Longest word, in characters. */
  maxLength: number
}

export type ConfigSetting =
  ChipsSetting | NumberSetting | TextSetting | LinesSetting | ChoiceSetting | WordsSetting

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

/** A short plain-text name, such as a button label. Up to 20 characters unless set. */
function text(
  group: ConfigGroup,
  value: string,
  description: string,
  options: { maxLength?: number; symbolsOnly?: true } = {},
): TextSetting {
  return {
    unit: 'text',
    group,
    default: value,
    maxLength: options.maxLength ?? 20,
    description,
    ...(options.symbolsOnly ? { symbolsOnly: true } : {}),
  }
}

/** One of a few named options. The first option listed is not special; `value` is the default. */
function choice<const V extends string>(
  group: ConfigGroup,
  value: NoInfer<V>,
  options: readonly ChoiceOption<V>[],
  description: string,
): ChoiceSetting<V> {
  return { unit: 'choice', group, default: value, options, description }
}

/** A command's words: up to 8, each up to 16 lowercase letters and digits. */
function words(label: string, value: readonly string[], description: string): WordsSetting {
  return {
    unit: 'words',
    group: 'commands',
    label,
    default: value,
    maxWords: 8,
    maxLength: 16,
    description,
  }
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
    1_000,
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
    10,
    'Streak bonus added for each game day in a row a player collects. A missed day resets it.',
  ),
  streak_max: chips('economy', 100, 'Most the streak bonus can grow to.'),
  challenges_per_day: number('economy', 'count', 3, 'Challenges each player gets per game day.', {
    max: 10,
  }),
  challenge_reward_min: chips('economy', 20, 'Smallest reward for finishing a challenge.'),
  challenge_reward_max: chips('economy', 40, 'Largest reward for finishing a challenge.'),

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
  work_pay_min: chips('economy', 20, 'Least a press of the work button pays.'),
  work_pay_max: chips('economy', 60, 'Most a press of the work button pays.'),
  crime_cooldown_minutes: number('economy', 'minutes', 120, 'Minutes between crimes.', {
    min: 1,
    max: 1_440,
  }),
  crime_success_pct: share('economy', 4_500, 'Chance a crime pays instead of ending in a fine.'),
  crime_pay_min: chips('economy', 600, 'Least a crime that works pays.'),
  crime_pay_max: chips('economy', 1_500, 'Most a crime that works pays.'),
  crime_fine_min: chips(
    'economy',
    100,
    'Smallest fine for a failed crime. A fine never takes the wallet below zero.',
  ),
  crime_fine_max: chips('economy', 300, 'Largest fine for a failed crime.'),
  crime_chat_min: chips(
    'economy',
    1_400,
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
  hustle_pay_min: chips('economy', 200, 'Least the third income button pays when it works.'),
  hustle_pay_max: chips('economy', 500, 'Most the third income button pays when it works.'),
  hustle_fine_min: chips(
    'economy',
    50,
    'Smallest fine from the third income button. A fine never takes the wallet below zero.',
  ),
  hustle_fine_max: chips('economy', 150, 'Largest fine from the third income button.'),

  // Ranks (tiers in code). Unlock days count from 1, the season's first game day.
  tier_income_cap_hours: number(
    'ranks',
    'hours',
    24,
    'Uncollected rank income stops growing after this many hours.',
    { min: 1, max: 720 },
  ),
  tier_base_income: chips('ranks', 50, 'Base rank: income per day.'),
  tier_bronze_price: chips('ranks', 1_500, 'Bronze rank: price.'),
  tier_bronze_income: chips('ranks', 150, 'Bronze rank: income per day.'),
  tier_bronze_unlock_day: number(
    'ranks',
    'days',
    1,
    'Bronze rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_silver_price: chips('ranks', 10_000, 'Silver rank: price.'),
  tier_silver_income: chips('ranks', 1_000, 'Silver rank: income per day.'),
  tier_silver_unlock_day: number(
    'ranks',
    'days',
    3,
    'Silver rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_gold_price: chips('ranks', 100_000, 'Gold rank: price.'),
  tier_gold_income: chips('ranks', 10_000, 'Gold rank: income per day.'),
  tier_gold_unlock_day: number(
    'ranks',
    'days',
    6,
    'Gold rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_platinum_price: chips('ranks', 1_000_000, 'Platinum rank: price.'),
  tier_platinum_income: chips('ranks', 100_000, 'Platinum rank: income per day.'),
  tier_platinum_unlock_day: number(
    'ranks',
    'days',
    10,
    'Platinum rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_diamond_price: chips('ranks', 10_000_000, 'Diamond rank: price.'),
  tier_diamond_income: chips('ranks', 1_000_000, 'Diamond rank: income per day.'),
  tier_diamond_unlock_day: number(
    'ranks',
    'days',
    14,
    'Diamond rank: first season day it can be bought.',
    { min: 1, max: 60 },
  ),
  tier_crown_price: chips('ranks', 100_000_000, 'Crown rank: price.'),
  tier_crown_income: chips('ranks', 10_000_000, 'Crown rank: income per day.'),
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
  chat_drop_pot: chips('giveaways', 100, 'Chips in each chat drop, split between its winners.', {
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
  steal_min_fine: chips(
    'steals',
    10,
    "Smallest fine for a failed steal, or the thief's whole wallet if it holds less.",
  ),
  immunity_hours: number(
    'steals',
    'hours',
    3,
    'Immunity after being robbed or after a shield blocks a steal.',
    { max: 72 },
  ),
  steal_floor: chips('steals', 250, 'Players with less net worth than this cannot be robbed.'),
  steal_min_take: chips(
    'steals',
    10,
    'Smallest steal. A player a steal would take less from cannot be picked.',
  ),
  extra_steal_price_pct: share(
    'steals',
    200,
    "Price of the one extra steal attempt per game day, as a share of the buyer's wallet.",
    { provisional: true },
  ),
  extra_steal_price_min: chips('steals', 30, 'Lowest price of the extra steal attempt.', {
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
  shield_price_min: chips('shields', 30, 'Lowest price of a shield charge.'),

  // Vault
  vault_cap_pct: share(
    'vault',
    2_500,
    "Most of a player's net worth the vault can hold, checked at deposit.",
  ),

  // Games
  min_bet: chips('games', 25, 'Smallest bet in any game.', { min: 0 }),
  max_bet_pct: share('games', 10_000, 'Largest bet as a share of the wallet. 100% allows all-in.', {
    min: 1,
  }),
  big_bet_pct: share(
    'games',
    5_000,
    'A bet at or above this share of net worth is flagged as a big bet in the room.',
    { min: 1 },
  ),
  big_win_times: number(
    'games',
    'times',
    10,
    'A win paying this many times the bet or more gets the full celebration and a post in chat. So does any won all-in.',
    { min: 2, max: 10_000 },
  ),
  round_timeout_minutes: number(
    'games',
    'minutes',
    10,
    'An open round left this long is finished by its safest rule: blackjack stands, mines cashes out.',
    { min: 1, max: 1_440, provisional: true },
  ),
  coinflip_edge_pct: share(
    'games',
    200,
    'Coin flip house edge: a win pays twice the bet, less this share.',
    { max: 2_000 },
  ),
  blackjack_slow_reveal_pct: share(
    'games',
    5_000,
    "Blackjack: a bet over this share of the player's wallet, or any all-in, gets the slow reveal: a hit on a hard 12 or more, and the dealer's hidden card, come out face down, lift slowly, then flip.",
    { min: 1 },
  ),
  blackjack_slow_lift_ms: number(
    'games',
    'milliseconds',
    900,
    'Blackjack: how long a slow-reveal card lifts before it flips.',
    { min: 0, max: 5_000 },
  ),
  blackjack_slow_flip_ms: number(
    'games',
    'milliseconds',
    400,
    'Blackjack: how long a slow-reveal card takes to flip.',
    { min: 100, max: 2_000 },
  ),
  roulette_close_after_seconds: number(
    'games',
    'seconds',
    15,
    'Roulette: a round closes this many seconds after its latest bet. Each new bet starts the countdown again.',
    { min: 3, max: 120 },
  ),
  roulette_max_open_seconds: number(
    'games',
    'seconds',
    60,
    'Roulette: a round closes at the latest this many seconds after its first bet, however many bets keep coming.',
    { min: 5, max: 600 },
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
  // taking effect at once. The economy lane wrote the line pools
  // (shared/config-lines.ts).
  hustle_name: text('text', 'Slut', "The third income button's name, after UnbelievaBoat's .slut."),
  work_lines: lines(
    'text',
    WORK_LINES,
    'Work: one line is picked at random to show with each payout.',
  ),
  crime_win_lines: lines(
    'text',
    CRIME_WIN_LINES,
    'Crime: one line is picked at random to show with a crime that pays.',
  ),
  crime_fine_lines: lines(
    'text',
    CRIME_FINE_LINES,
    'Crime: one line is picked at random to show with a fine.',
  ),
  hustle_win_lines: lines(
    'text',
    HUSTLE_WIN_LINES,
    'Third income button: one line is picked at random to show when it pays. Joke-level, suggestive at most.',
  ),
  hustle_fine_lines: lines(
    'text',
    HUSTLE_FINE_LINES,
    'Third income button: one line is picked at random to show with a fine.',
  ),

  // Commands typed in the message box (spec: Commands), edited in the admin
  // panel and taking effect at once. Each command is a list of words: the
  // first is its name in the command list, the rest are aliases, and no word
  // belongs to two commands. What each one does and what it takes after it
  // live in its game's or feature's manifest. Games still to come have
  // their words already, so their lanes need no shared change.
  command_prefix: text(
    'commands',
    '.',
    'What starts a command in the message box, such as the dot in .bj 50. One to three symbols.',
    { maxLength: 3, symbolsOnly: true },
  ),
  command_blackjack: words(
    'Blackjack',
    ['bj', 'blackjack'],
    'Blackjack: deals a hand at the bet typed after it.',
  ),
  command_roulette: words(
    'Roulette',
    ['roulette', 'rl'],
    'Roulette: bets on the open round, or starts one, such as roulette 200 odd.',
  ),
  command_coinflip: words(
    'Coin flip',
    ['flip', 'coinflip', 'cf'],
    'Coin flip: flips a coin at the bet typed after it.',
  ),
  command_crash: words(
    'Crash',
    ['crash'],
    'Crash: joins the next round at the bet typed after it.',
  ),
  command_mines: words('Mines', ['mines'], 'Mines: starts a board at the bet typed after it.'),
  command_plinko: words('Plinko', ['plinko'], 'Plinko: drops a ball at the bet typed after it.'),
  command_slots: words('Slots', ['slots'], 'Slots: spins at the bet typed after it.'),
  command_russian_roulette: words(
    'Russian roulette',
    ['rr'],
    'Russian roulette: opens a lobby at the ante typed after it, or joins the open one.',
  ),
  command_race: words('Race', ['race'], 'Race: bets on a runner in the next race.'),
  command_work: words(
    'Work',
    ['work', 'w'],
    'Work: earns a few chips, then waits out its cooldown.',
  ),
  command_hustle: words(
    'Slut',
    ['slut'],
    'The third income command, shown with the name in hustle_name.',
  ),
  command_crime: words('Crime', ['crime'], 'Crime: a big payout or a fine, then a long cooldown.'),
  command_collect: words(
    'Collect',
    ['collect'],
    "Collect: takes the day's income and the streak bonus.",
  ),
  command_rob: words(
    'Rob',
    ['rob', 'steal'],
    'Rob: tries to steal from the player named after it.',
  ),
  command_deposit: words(
    'Deposit',
    ['dep', 'deposit'],
    'Vault: moves the amount typed after it from the wallet into the vault.',
  ),
  command_withdraw: words(
    'Withdraw',
    ['with', 'withdraw'],
    'Vault: moves the amount typed after it from the vault back to the wallet.',
  ),
  command_balance: words(
    'Balance',
    ['bal', 'balance'],
    "Balance: shows a player's wallet, vault and rank.",
  ),
  command_leaderboard: words(
    'Leaderboard',
    ['lb', 'leaderboard', 'top'],
    "Leaderboard: shows the season's standings.",
  ),
  command_shop: words('Shop', ['shop', 'store'], 'Shop: opens the shop.'),
  command_help: words('Help', ['help', 'commands'], 'Help: lists every command.'),
  command_admin: words('Admin', ['admin'], 'Admin: opens the admin panel. Admins only.'),

  // The stream (spec: The stream), taking effect at once.
  stream_round_runs: choice(
    'stream',
    'fold',
    [
      { value: 'fold', label: 'Fold into one line' },
      { value: 'separate', label: 'One line per round' },
    ],
    "Whether a run of one player's finished rounds folds into one line, such as Bob · 6 hands · +45, or each round keeps its own line.",
  ),
  stream_bal_lb: choice(
    'stream',
    'private',
    [
      { value: 'private', label: 'Only the player who asked' },
      { value: 'public', label: 'Posted in the stream' },
    ],
    'Whether the balance and leaderboard commands answer only the player who typed them, or post in the stream for everyone.',
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

/**
 * A config value in code: bigint for chips, a string for text and choices, a
 * list for lines and words, number for the rest.
 */
export type ConfigValue = bigint | number | string | readonly string[]

/** Every config value, typed: a choice as the union of its options. */
export type ConfigValues = {
  [K in ConfigKey]: (typeof CONFIG)[K] extends ChipsSetting
    ? bigint
    : (typeof CONFIG)[K] extends TextSetting
      ? string
      : (typeof CONFIG)[K] extends ChoiceSetting<infer V>
        ? V
        : (typeof CONFIG)[K] extends LinesSetting | WordsSetting
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

// What a symbols-only setting refuses. An @ would turn every mention into a command.
const NOT_A_SYMBOL = /[\p{L}\p{N}\s@]/u

function parseText(key: ConfigKey, s: TextSetting, raw: unknown): ParsedValue {
  if (typeof raw !== 'string') return { ok: false, error: `${key} must be text.` }
  const value = raw.trim()
  if (!value || value.length > s.maxLength) {
    return { ok: false, error: `${key} must be 1 to ${s.maxLength} characters.` }
  }
  if (CONTROL_CHARACTERS.test(value)) {
    return { ok: false, error: `${key} must be plain text on one line.` }
  }
  if (s.symbolsOnly && NOT_A_SYMBOL.test(value)) {
    return {
      ok: false,
      error: `${key} must be 1 to ${s.maxLength} symbols, with no letters, digits, spaces or @.`,
    }
  }
  return { ok: true, value }
}

function parseChoice(key: ConfigKey, s: ChoiceSetting, raw: unknown): ParsedValue {
  const option = s.options.find((o) => o.value === raw)
  if (!option) {
    const names = s.options.map((o) => o.value)
    return {
      ok: false,
      error: `${key} must be ${names.slice(0, -1).join(', ')} or ${names.at(-1)}.`,
    }
  }
  return { ok: true, value: option.value }
}

/** A word after the prefix: lowercase letters and digits, starting with a letter. */
const COMMAND_WORD = /^[a-z][a-z0-9]*$/

function parseWords(key: ConfigKey, s: WordsSetting, raw: unknown): ParsedValue {
  if (!Array.isArray(raw) || raw.some((word) => typeof word !== 'string')) {
    return { ok: false, error: `${key} must be a list of words.` }
  }
  const value = (raw as string[]).map((word) => word.trim().toLowerCase())
  if (value.length === 0 || value.length > s.maxWords) {
    return { ok: false, error: `${s.label} needs between 1 and ${s.maxWords} words.` }
  }
  for (const [i, word] of value.entries()) {
    if (!COMMAND_WORD.test(word) || word.length > s.maxLength) {
      return {
        ok: false,
        error: `${word ? `"${word}"` : 'An empty word'} cannot be a word for ${s.label}: use 1 to ${s.maxLength} letters and digits, starting with a letter.`,
      }
    }
    if (value.indexOf(word) !== i) {
      return { ok: false, error: `${s.label} has "${word}" twice.` }
    }
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
 * Checks a value in its wire form (a plain number with chips as whole chips, a
 * string for text, or a list of strings for lines) against the key's unit and
 * limits.
 */
export function parseConfigValue(key: ConfigKey, raw: unknown): ParsedValue {
  const s = setting(key)
  if (s.unit === 'text') return parseText(key, s, raw)
  if (s.unit === 'lines') return parseLines(key, s, raw)
  if (s.unit === 'choice') return parseChoice(key, s, raw)
  if (s.unit === 'words') return parseWords(key, s, raw)
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
  if (s.unit === 'choice') return s.options.find((o) => o.value === value)?.label ?? String(value)
  if (s.unit === 'words' && typeof value === 'object') return value.join(', ')
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

/**
 * A value for people: "100 chips", "1.5%", "3 hours", "1000x", "8 lines",
 * "bj, blackjack", or a choice's label.
 */
export function formatConfigValue(key: ConfigKey, value: ConfigValue): string {
  return formatValue(setting(key), value)
}

/** The value as it travels and is stored: chips as a plain number of chips. */
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

/** A command's key: a words setting, such as command_blackjack. */
export type CommandKey = {
  [K in ConfigKey]: (typeof CONFIG)[K] extends WordsSetting ? K : never
}[ConfigKey]

/** Every command's key. Their words share one set: no word belongs to two. */
export const COMMAND_KEYS = CONFIG_KEYS.filter(
  (key): key is CommandKey => setting(key).unit === 'words',
)

/**
 * Why `value` cannot be `key`'s words, if another command already has one of
 * them, as a sentence for the admin panel: "rl already belongs to Roulette."
 * `current` holds the other commands' words; a key it lacks counts at its
 * default. changeConfig refuses the change with this sentence, and the
 * admin panel can call it first to warn as the admin types.
 */
export function commandWordClash(
  key: ConfigKey,
  value: readonly string[],
  current: Partial<Record<ConfigKey, ConfigValue>>,
): string | undefined {
  for (const other of COMMAND_KEYS) {
    if (other === key) continue
    const theirs = (current[other] ?? setting(other).default) as readonly string[]
    const word = value.find((w) => theirs.includes(w))
    if (word) return `"${word}" already belongs to ${(setting(other) as WordsSetting).label}.`
  }
  return undefined
}

export interface TierSettings {
  /** Chips. Zero for the base tier. */
  price: bigint
  /** Chips per day. */
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
