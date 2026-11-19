/**
 * The economy (spec: Economy): rank income and the Collect button, the
 * streak bonus, the three income buttons (work, the third one, crime),
 * daily challenges and chat drops. Shared by the browser and the server:
 * the types, the input schemas, the live events and the pure math. The
 * server draws every outcome with node:crypto (server/features/economy/);
 * nothing here is random.
 *
 * Chips are hundredths, as everywhere: bigint in the math, plain numbers on
 * the wire. Ranks are `tier` in code, because "rank" means a leaderboard place.
 */
import { z } from 'zod'

import { CHIP, floorToChip, formatMultiplier, mulDiv } from '../chips.ts'
import type { ConfigValues } from '../config.ts'
import { tierSettings } from '../config.ts'
import { addGameDays, gameDay, gameDayStart } from '../game-day.ts'
import type { LedgerReason } from '../ledger.ts'
import { type Tier, TIERS } from '../tiers.ts'

const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS

// ---------------------------------------------------------------- ranks (tiers)

/** The rank after this one, or null at the top. */
export function nextTier(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier)
  return TIERS[i + 1] ?? null
}

/** Where a tier sits: base is 0, crown is 6. */
export function tierLevel(tier: Tier): number {
  return TIERS.indexOf(tier)
}

/**
 * The moment a rank can first be bought: the start of season day
 * `unlockDay` (day 1 is the game day the season starts in), at the 4:00 AM
 * Central reset. Day 1 is open from the season's start.
 */
export function tierUnlocksAt(seasonStartsAt: Date, unlockDay: number): Date {
  const first = gameDay(seasonStartsAt)
  return gameDayStart(addGameDays(first, Math.max(1, unlockDay) - 1))
}

/**
 * Rank income earned over `elapsedMs` at `perDay` hundredths a day, capped
 * at `capHours` of income, rounded down to a hundredth. Exact (bigint): the
 * server pays this.
 */
export function accruedIncome(perDay: bigint, elapsedMs: bigint, capHours: number): bigint {
  if (perDay <= 0n || elapsedMs <= 0n) return 0n
  const cap = BigInt(Math.max(0, Math.floor(capHours))) * BigInt(HOUR_MS)
  const counted = elapsedMs < cap ? elapsedMs : cap
  return mulDiv(perDay, counted, BigInt(DAY_MS))
}

/** The same, in plain numbers, for a counter that ticks in the browser. Display only. */
export function accruedIncomeShown(perDay: number, elapsedMs: number, capHours: number): number {
  if (perDay <= 0 || elapsedMs <= 0) return 0
  const counted = Math.min(elapsedMs, Math.max(0, capHours) * HOUR_MS)
  return Math.floor((perDay * counted) / DAY_MS)
}

/** Milliseconds until uncollected income stops growing, from `elapsedMs`. */
export function incomeFullInMs(elapsedMs: number, capHours: number): number {
  return Math.max(0, capHours * HOUR_MS - elapsedMs)
}

// ---------------------------------------------------------------- the streak bonus

/** The streak a collect today makes: one more than yesterday's, or 1 after a missed day. */
export function streakDays(yesterday: { bonusClaimed: boolean; streak: number } | null): number {
  return yesterday?.bonusClaimed ? Math.max(0, yesterday.streak) + 1 : 1
}

/** The bonus for day `days` of a streak: `streak_step` a day, at most `streak_max`. */
export function streakBonus(days: number, step: bigint, max: bigint): bigint {
  if (days <= 0) return 0n
  const bonus = BigInt(days) * step
  return bonus < max ? bonus : max
}

/** The first day of a streak whose bonus is the most it can be. */
export function streakMaxDay(step: bigint, max: bigint): number {
  if (step <= 0n || max <= 0n) return 0
  return Number((max + step - 1n) / step)
}

/**
 * True on a streak day worth a chat post: the day the bonus first reaches its
 * most (day 10 at the start values), then every time the streak grows by as
 * many days again (20, 30 and so on).
 */
export function streakMilestone(days: number, step: bigint, max: bigint): boolean {
  const first = streakMaxDay(step, max)
  if (first <= 0 || days < first) return false
  return (days - first) % first === 0
}

// ---------------------------------------------------------------- work, the third button, crime

/** The three income buttons. The third is "hustle" in code; its name is the hustle_name setting. */
export const INCOME_COMMANDS = ['work', 'hustle', 'crime'] as const
export type IncomeCommand = (typeof INCOME_COMMANDS)[number]

export interface CommandSettings {
  cooldownMinutes: number
  /** Chance of a payout in basis points; work always pays (10,000). */
  successPct: number
  payMin: bigint
  payMax: bigint
  /** Zero for work, which never fines. */
  fineMin: bigint
  fineMax: bigint
}

/** A command's numbers from the config. */
export function commandSettings(config: ConfigValues, command: IncomeCommand): CommandSettings {
  switch (command) {
    case 'work':
      return {
        cooldownMinutes: config.work_cooldown_minutes,
        successPct: 10_000,
        payMin: config.work_pay_min,
        payMax: config.work_pay_max,
        fineMin: 0n,
        fineMax: 0n,
      }
    case 'hustle':
      return {
        cooldownMinutes: config.hustle_cooldown_minutes,
        successPct: config.hustle_success_pct,
        payMin: config.hustle_pay_min,
        payMax: config.hustle_pay_max,
        fineMin: config.hustle_fine_min,
        fineMax: config.hustle_fine_max,
      }
    case 'crime':
      return {
        cooldownMinutes: config.crime_cooldown_minutes,
        successPct: config.crime_success_pct,
        payMin: config.crime_pay_min,
        payMax: config.crime_pay_max,
        fineMin: config.crime_fine_min,
        fineMax: config.crime_fine_max,
      }
  }
}

/**
 * The step a payout or fine is drawn in: whole chips when both ends of the
 * range are whole chips (2 to 6 pays 2, 3, 4, 5 or 6), else hundredths.
 */
export function drawStep(min: bigint, max: bigint): bigint {
  return min % CHIP === 0n && max % CHIP === 0n ? CHIP : 1n
}

/** How many values a range holds at its step, so a draw of 0..count-1 picks one. */
export function rangeCount(min: bigint, max: bigint): bigint {
  if (max <= min) return 1n
  return (max - min) / drawStep(min, max) + 1n
}

/** The value at position `index` (0-based) of a range. */
export function rangeValue(min: bigint, max: bigint, index: bigint): bigint {
  if (max <= min) return min
  const value = min + index * drawStep(min, max)
  return value > max ? max : value
}

/** The average of a range drawn evenly, in hundredths. */
export function rangeMean(min: bigint, max: bigint): number {
  if (max <= min) return Number(min)
  const step = drawStep(min, max)
  const top = min + ((max - min) / step) * step
  return (Number(min) + Number(top)) / 2
}

/** What a press is worth on average, in hundredths (a fine counted in full). */
export function expectedPerPress(s: CommandSettings): number {
  const p = s.successPct / 10_000
  return p * rangeMean(s.payMin, s.payMax) - (1 - p) * rangeMean(s.fineMin, s.fineMax)
}

/** What pressing the button whenever it is ready earns in an hour, on average. */
export function expectedPerHour(s: CommandSettings): number {
  return (expectedPerPress(s) * 60) / Math.max(1, s.cooldownMinutes)
}

/** What a draw needs: the server passes node:crypto's (server/lib/rng.ts). */
export interface Draw {
  /** True with probability numerator / denominator. */
  chance(numerator: number, denominator: number): boolean
  /** A whole number in [0, n). */
  below(n: number): number
}

/** A press of a button: paid or fined, what was drawn, and what moves (a fine stops at the wallet). */
export interface Press {
  paid: boolean
  drawn: bigint
  amount: bigint
}

/** Draws one press of a button for a player holding `balance` in their wallet. */
export function drawPress(settings: CommandSettings, balance: bigint, draw: Draw): Press {
  const paid = draw.chance(settings.successPct, 10_000)
  const [min, max] = paid
    ? [settings.payMin, settings.payMax]
    : [settings.fineMin, settings.fineMax]
  const drawn = rangeValue(min, max, BigInt(draw.below(Number(rangeCount(min, max)))))
  const amount = paid ? drawn : drawn < balance ? drawn : balance > 0n ? balance : 0n
  return { paid, drawn, amount }
}

/** The ledger reason for a command's result. */
export function incomeReason(command: IncomeCommand, paid: boolean): LedgerReason {
  if (command === 'work') return 'work'
  if (command === 'hustle') return paid ? 'hustle_win' : 'hustle_fine'
  return paid ? 'crime_win' : 'crime_fine'
}

/** The config key whose lines go with a result. */
export function linesKey(
  command: IncomeCommand,
  paid: boolean,
):
  'work_lines' | 'hustle_win_lines' | 'hustle_fine_lines' | 'crime_win_lines' | 'crime_fine_lines' {
  if (command === 'work') return 'work_lines'
  if (command === 'hustle') return paid ? 'hustle_win_lines' : 'hustle_fine_lines'
  return paid ? 'crime_win_lines' : 'crime_fine_lines'
}

/** A command's name on screen. The third one is a setting. */
export function commandName(command: IncomeCommand, hustleName: string): string {
  if (command === 'work') return 'Work'
  if (command === 'crime') return 'Crime'
  return hustleName
}

// ---------------------------------------------------------------- challenges

/**
 * What a challenge measures over the player's settled rounds of the game day:
 * - rounds: rounds played
 * - wins: rounds that paid more than the stake
 * - games: different games played
 * - winStreak: the longest run of wins in a row
 * - bestMultiplier: the best multiplier on a win, in hundredths
 * - allInWins: all-in bets won
 */
export const CHALLENGE_METRICS = [
  'rounds',
  'wins',
  'games',
  'winStreak',
  'bestMultiplier',
  'allInWins',
] as const
export type ChallengeMetric = (typeof CHALLENGE_METRICS)[number]

/** 1 is easy, 3 is hard. The reward grows with it. */
export type ChallengeLevel = 1 | 2 | 3

export interface ChallengeSpec {
  /** Stable for the day: the metric, the target and the game, such as "wins-3-blackjack". */
  id: string
  metric: ChallengeMetric
  /** Only rounds of this game count. Null for any game. */
  game: string | null
  /** A count, or for bestMultiplier a multiplier in hundredths (300 is 3x). */
  target: number
  level: ChallengeLevel
}

/** A challenge as saved in daily_state.challenges for one player and game day. */
export interface SavedChallenge extends ChallengeSpec {
  /** Hundredths. */
  reward: number
  /** When it was claimed, or null. */
  claimedAt: string | null
}

/** One settled round, as challenges read them. Amounts in hundredths. */
export interface ChallengeRound {
  game: string
  stake: number
  payout: number
  /** Hundredths of a multiplier, as rounds store it. */
  multiplier: number | null
  allIn: boolean
}

function challengeId(metric: ChallengeMetric, target: number, game: string | null): string {
  return `${metric}-${target}${game ? `-${game}` : ''}`
}

/** Reads a challenge back from its id ("wins-3-blackjack"), or null. */
export function parseChallengeId(id: string): Omit<ChallengeSpec, 'level'> | null {
  const match = /^([A-Za-z]+)-(\d+)(?:-(.+))?$/.exec(id)
  if (!match) return null
  const metric = match[1] as ChallengeMetric
  if (!(CHALLENGE_METRICS as readonly string[]).includes(metric)) return null
  return { id, metric, target: Number(match[2]), game: match[3] ?? null }
}

function spec(
  metric: ChallengeMetric,
  target: number,
  level: ChallengeLevel,
  game: string | null = null,
): ChallengeSpec {
  return { id: challengeId(metric, target, game), metric, game, target, level }
}

/** What the season has seen so far, so no challenge asks for the impossible. */
export interface SeasonPlay {
  /** Each game with settled rounds this season, and the best multiplier won there (hundredths). */
  games: readonly { game: string; bestMultiplier: number }[]
}

/** Multipliers a challenge may ask for, when the season has seen them won. */
export const MULTIPLIER_TARGETS = [300, 1_000] as const

/**
 * Every challenge the pool can offer today. Game-specific ones only for
 * games played this season, multiplier ones only where that multiplier has
 * been won, and "different games" only when there are that many games.
 */
export function challengePool(play: SeasonPlay): ChallengeSpec[] {
  const games = play.games
  const best = Math.max(0, ...games.map((g) => g.bestMultiplier))
  const pool: ChallengeSpec[] = [
    spec('rounds', 10, 1),
    spec('wins', 3, 1),
    spec('rounds', 25, 2),
    spec('wins', 8, 2),
    spec('winStreak', 3, 3),
    spec('allInWins', 1, 3),
    spec('wins', 15, 3),
  ]
  if (games.length >= 2) pool.push(spec('games', 2, 1))
  if (games.length >= 3) pool.push(spec('games', 3, 2))
  if (best >= 300) pool.push(spec('bestMultiplier', 300, 2))
  if (best >= 1_000) pool.push(spec('bestMultiplier', 1_000, 3))
  for (const { game, bestMultiplier } of games) {
    pool.push(spec('rounds', 5, 1, game))
    pool.push(spec('wins', 3, 2, game))
    if (bestMultiplier >= 300) pool.push(spec('bestMultiplier', 300, 3, game))
    if (bestMultiplier >= 1_000) pool.push(spec('bestMultiplier', 1_000, 3, game))
  }
  return pool
}

/**
 * Picks `count` challenges from the pool: easy, medium and hard in turn, never
 * two that measure the same thing in the same game. `choose(n)` returns a
 * whole number in [0, n); the server passes its crypto draw.
 */
export function pickChallenges(
  pool: readonly ChallengeSpec[],
  count: number,
  choose: (n: number) => number,
): ChallengeSpec[] {
  const picked: ChallengeSpec[] = []
  const clashes = (a: ChallengeSpec, b: ChallengeSpec) => a.metric === b.metric && a.game === b.game
  for (let i = 0; i < count; i++) {
    const level = ((i % 3) + 1) as ChallengeLevel
    const free = pool.filter((c) => !picked.some((p) => p.id === c.id || clashes(p, c)))
    if (free.length === 0) break
    const atLevel = free.filter((c) => c.level === level)
    const from = atLevel.length > 0 ? atLevel : free
    const choice = from[choose(from.length)]
    if (choice) picked.push(choice)
  }
  return picked
}

/** A challenge's reward: the low end of the range when easy, the middle for medium, the top when hard. */
export function challengeReward(level: ChallengeLevel, min: bigint, max: bigint): bigint {
  const top = max > min ? max : min
  const amount = level === 1 ? min : level === 3 ? top : min + (top - min) / 2n
  return drawStep(min, max) === CHIP ? floorToChip(amount) : amount
}

const won = (r: ChallengeRound) => r.payout > r.stake

/**
 * How far a challenge has got, from the day's settled rounds in the order
 * they settled. Never more than the target: done when it equals it.
 */
export function challengeProgress(c: ChallengeSpec, rounds: readonly ChallengeRound[]): number {
  const mine = c.game === null ? rounds : rounds.filter((r) => r.game === c.game)
  let value = 0
  switch (c.metric) {
    case 'rounds':
      value = mine.length
      break
    case 'wins':
      value = mine.filter(won).length
      break
    case 'games':
      value = new Set(mine.map((r) => r.game)).size
      break
    case 'winStreak': {
      let run = 0
      for (const r of mine) {
        run = won(r) ? run + 1 : 0
        value = Math.max(value, run)
      }
      break
    }
    case 'bestMultiplier':
      value = Math.max(0, ...mine.filter(won).map((r) => r.multiplier ?? 0))
      break
    case 'allInWins':
      value = mine.filter((r) => r.allIn && won(r)).length
      break
  }
  return Math.min(value, c.target)
}

/** Whether a settled round could move a challenge on, so the browser knows to ask. */
export function couldAdvance(c: ChallengeSpec, round: Pick<ChallengeRound, 'game'>): boolean {
  return c.game === null || c.game === round.game
}

/** A challenge in words, given its game's name. */
export function describeChallenge(c: ChallengeSpec, gameName?: string): string {
  const game = c.game ? (gameName ?? c.game) : null
  const times = (n: number) => (n === 1 ? 'once' : `${n} times`)
  switch (c.metric) {
    case 'rounds':
      return game ? `Play ${game} ${times(c.target)}` : `Play ${c.target} rounds`
    case 'wins':
      return game ? `Win at ${game} ${times(c.target)}` : `Win ${c.target} rounds`
    case 'games':
      return `Play ${c.target} different games`
    case 'winStreak':
      return `Win ${c.target} rounds in a row`
    case 'bestMultiplier':
      return game
        ? `Win ${formatMultiplier(c.target)} or more at ${game}`
        : `Win a round paying ${formatMultiplier(c.target)} or more`
    case 'allInWins':
      return c.target === 1 ? 'Win an all-in bet' : `Win ${c.target} all-in bets`
  }
}

/** Progress in words, such as "2 of 3" or "best 1.96x of 3x". */
export function describeProgress(c: ChallengeSpec, progress: number): string {
  if (c.metric === 'bestMultiplier') {
    return progress >= c.target
      ? `${formatMultiplier(c.target)} reached`
      : progress > 0
        ? `Best ${formatMultiplier(progress)} of ${formatMultiplier(c.target)}`
        : `Not yet`
  }
  return `${progress} of ${c.target}`
}

// ---------------------------------------------------------------- chat drops

/** Each winner's share of a drop, rounded down to a hundredth. */
export function dropShare(pot: bigint, winners: number): bigint {
  if (winners <= 0 || pot <= 0n) return 0n
  return pot / BigInt(winners)
}

/**
 * Seconds until the next drop: anywhere from half to one and a half times the
 * average, so the average is `chat_drop_every_minutes`. `draw(n)` returns a
 * whole number in [0, n).
 */
export function dropDelaySeconds(averageMinutes: number, draw: (n: number) => number): number {
  const average = Math.max(1, averageMinutes) * 60
  const low = Math.floor(average / 2)
  const span = average + 1
  return low + draw(span)
}

// ---------------------------------------------------------------- the activity list

/** Ledger reasons the economy writes, shown in the player's activity list. */
export const ECONOMY_REASONS = [
  'work',
  'hustle_win',
  'hustle_fine',
  'crime_win',
  'crime_fine',
  'rank_income',
  'daily_bonus',
  'challenge',
  'chat_drop',
  'rank_purchase',
] as const satisfies readonly LedgerReason[]
export type EconomyReason = (typeof ECONOMY_REASONS)[number]

/** How many activity entries the state carries. */
export const ACTIVITY_SIZE = 8

/** How many recent drops the state carries. */
export const RECENT_DROPS = 6

// ---------------------------------------------------------------- inputs

/** The buttons and Collect take no fields; anything sent is refused. */
export const NoInput = z.strictObject({})
export type NoInput = z.infer<typeof NoInput>

/** POST /api/economy/tier: the rank the player means to buy, which must be the next one. */
export const TierBuyInput = z.strictObject({
  tier: z.enum(TIERS, { error: 'Pick a rank to buy.' }),
})
export type TierBuyInput = z.infer<typeof TierBuyInput>

/** POST /api/economy/challenges/claim */
export const ChallengeClaimInput = z.strictObject({
  index: z
    .number('Pick a challenge to claim.')
    .int('Pick a challenge to claim.')
    .min(0, 'Pick a challenge to claim.')
    .max(20, 'Pick a challenge to claim.'),
})
export type ChallengeClaimInput = z.infer<typeof ChallengeClaimInput>

/** POST /api/economy/drops/claim */
export const DropClaimInput = z.strictObject({
  dropId: z
    .number('Pick a drop to grab.')
    .int('Pick a drop to grab.')
    .positive('Pick a drop to grab.')
    .max(Number.MAX_SAFE_INTEGER, 'Pick a drop to grab.'),
})
export type DropClaimInput = z.infer<typeof DropClaimInput>

// ---------------------------------------------------------------- what the API sends (chips as hundredths)

/** A rank as the shop and the Daily panel show it. Chips are hundredths. */
export interface TierStepView {
  tier: Tier
  /** Zero for the base rank. */
  price: number
  perDay: number
  /** The season day it can first be bought on; 0 for the base rank. */
  unlockDay: number
  /** When it can first be bought. */
  unlocksAt: string
}

export type NextTierView = TierStepView

export interface ChallengeView extends ChallengeSpec {
  index: number
  reward: number
  progress: number
  done: boolean
  claimed: boolean
}

export interface DropView {
  id: number
  /** The chat post that announced it. */
  messageId: number | null
  pot: number
  winners: number
  /** What each winner gets. */
  share: number
  postedAt: string
  /** Shares are left and no newer drop has landed. */
  open: boolean
  claims: { userId: string; amount: number }[]
}

export interface ActivityItem {
  /** The ledger row. */
  id: number
  reason: EconomyReason
  delta: number
  /** The flavor line shown with a work, slut or crime result. */
  line: string | null
  /** A short detail: the rank bought or paid for, or the streak day. */
  note: string | null
  at: string
}

/** GET /api/economy/state: one player's economy. Private to them. */
export interface EconomyState {
  seasonId: number
  /** Grows with every change: `economy.changed` events not newer than it are stale. */
  version: number
  income: {
    tier: Tier
    /** Hundredths a day at the current rank. */
    perDay: number
    capHours: number
    /** When income started to build: the last collect, or the player's start in the season. */
    since: string
  }
  streak: {
    claimedToday: boolean
    /** Today's streak if collected, else the streak a collect today makes. */
    days: number
    /** Today's bonus, paid or waiting. */
    bonus: number
    /** Tomorrow's bonus, if the streak goes on. */
    nextBonus: number
    /** The most the bonus can be. */
    maxBonus: number
  }
  /** When each button can be pressed again, or null when it is ready. */
  cooldowns: Record<IncomeCommand, string | null>
  ranks: {
    boughtToday: boolean
    /** The rank up from the player's, or null at the top. */
    next: NextTierView | null
    /** Every rank, base first, as this season prices and unlocks them. */
    ladder: TierStepView[]
    /** When rank purchases close: the start of the final day. */
    closesAt: string
  }
  challenges: {
    /** The game day, YYYY-MM-DD. */
    day: string
    /** The next reset, when new challenges arrive. */
    resetsAt: string
    list: ChallengeView[]
  }
  /** Recent chat drops, newest first. */
  drops: DropView[]
  /** The player's latest economy results, newest first. */
  activity: ActivityItem[]
}

/** GET /api/economy/state. Null outside a season, or before the player has a wallet in it. */
export interface EconomyStateResponse {
  state: EconomyState | null
}

/** The wallet after a request, as the top bar takes it. */
export interface WalletAfter {
  seasonId: number
  balance: number
  vault: number
  version: number
}

/** POST /api/economy/work, /hustle and /crime */
export interface IncomeResult {
  command: IncomeCommand
  /** Paid, or fined (a fine stops at an empty wallet). */
  outcome: 'paid' | 'fined'
  /** Hundredths that moved: the payout, or the fine actually taken. */
  amount: number
  /** For a fine: what it would have been before it stopped at zero. */
  drawn: number
  line: string
  /** When the button is ready again. */
  readyAt: string
  /** A crime big enough to be posted in chat. */
  posted: boolean
}

export interface IncomeResponse {
  result: IncomeResult
  wallet: WalletAfter
  state: EconomyState
}

/** POST /api/economy/collect */
export interface CollectResponse {
  collected: { income: number; bonus: number; streak: number }
  wallet: WalletAfter
  state: EconomyState
}

/** POST /api/economy/tier */
export interface TierResponse {
  bought: { tier: Tier; price: number; income: number }
  wallet: WalletAfter
  state: EconomyState
}

/** POST /api/economy/challenges/claim */
export interface ChallengeClaimResponse {
  claimed: { index: number; reward: number }
  wallet: WalletAfter
  state: EconomyState
}

/** POST /api/economy/drops/claim */
export interface DropClaimResponse {
  claimed: { dropId: number; amount: number }
  wallet: WalletAfter
  state: EconomyState
}

// ---------------------------------------------------------------- chat posts

/** `meta` of a chat drop's system post, beside the usual SystemMeta fields. */
export interface DropPostMeta {
  tone: 'win'
  drop: { id: number; pot: number; winners: number; share: number }
}

/** Reads a chat drop from a system post's meta, or null. */
export function dropFromMeta(meta: unknown): DropPostMeta['drop'] | null {
  if (!meta || typeof meta !== 'object' || !('drop' in meta)) return null
  const drop = (meta as { drop: unknown }).drop
  if (!drop || typeof drop !== 'object') return null
  const { id, pot, winners, share } = drop as Record<string, unknown>
  if (typeof id !== 'number' || typeof pot !== 'number' || typeof winners !== 'number') return null
  return { id, pot, winners, share: typeof share === 'number' ? share : 0 }
}

// ---------------------------------------------------------------- live events

declare module '../events.ts' {
  interface UserEvents {
    /** The player's economy changed, from this tab or another. Version: the state's version. */
    'economy.changed': { seasonId: number }
  }
  interface ChatEvents {
    /** Someone grabbed a share of a chat drop. Version: the number of shares taken. */
    'drop.claimed': DropClaimed
  }
}

export interface DropClaimed {
  dropId: number
  userId: string
  amount: number
  /** Shares taken so far, this one included. */
  claims: number
  winners: number
}

// ---------------------------------------------------------------- ranks for screens

/** Each rank's price, income and unlock moment this season, for the rank ladder. */
export function tierLadder(
  config: ConfigValues,
  seasonStartsAt: Date,
): { tier: Tier; price: bigint; perDay: bigint; unlockDay: number; unlocksAt: Date }[] {
  return TIERS.map((tier) => {
    const s = tierSettings(config, tier)
    return {
      tier,
      price: s.price,
      perDay: s.income,
      unlockDay: s.unlockDay,
      unlocksAt: tierUnlocksAt(seasonStartsAt, s.unlockDay),
    }
  })
}
