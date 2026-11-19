/**
 * Heist (spec: Steal, shields and vault): the rules the browser and the
 * server share. The server decides every steal, shield and vault move inside
 * one locked transaction; the browser uses the same functions only to show
 * the odds, the take, the prices and why a player cannot be robbed.
 *
 * Chip amounts are bigint hundredths. Rates and prices from config are basis
 * points (100 is 1%), and every amount rounds down to a whole hundredth.
 *
 * Who can see what:
 * - Public: every steal attempt and its outcome, each player's immunity, how
 *   much of their daily loss cap is left, and whether you already tried them.
 * - Private: how many shield charges a player holds. A thief never learns it
 *   until a shield blocks them, which is the point of a shield.
 */
import { z } from 'zod'

import { parseBetAmount } from '../bet-amount.ts'
import { basisPoints, chipCount, formatShare } from '../chips.ts'
import type { ConfigValues } from '../config.ts'
import { addGameDays, gameDay, gameDayStart, seasonDay } from '../game-day.ts'
import { BET_TEXT_MAX } from '../rounds.ts'
import type { SeasonPhase } from '../seasons.ts'
import type { StealView } from '../steals.ts'

export const HEIST = 'heist'

// ---------------------------------------------------------------- inputs

/** POST /api/heist/steal */
export const StealInput = z.strictObject({
  targetId: z.uuid({ error: 'Pick a player to rob.' }),
})
export type StealInput = z.infer<typeof StealInput>

export const VAULT_DIRECTIONS = ['deposit', 'withdraw'] as const
export type VaultDirection = (typeof VAULT_DIRECTIONS)[number]

/** POST /api/heist/vault. The amount is typed like a bet: 50, 2.5k, half, all, max. */
export const VaultMoveInput = z.strictObject({
  direction: z.enum(VAULT_DIRECTIONS, { error: 'Choose deposit or withdraw.' }),
  amount: z
    .string('Type an amount, like 20, half or max.')
    .trim()
    .min(1, 'Type an amount, like 20, half or max.')
    .max(BET_TEXT_MAX, 'That amount is too long to read. Try 20, half or max.'),
})
export type VaultMoveInput = z.infer<typeof VaultMoveInput>

/** POST /api/heist/shield and POST /api/heist/extra-attempt take nothing but the request key. */
export const BuyInput = z.strictObject({})

/** GET /api/heist/steals */
export const StealListInput = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

// ---------------------------------------------------------------- the math

export type StealRates = Pick<
  ConfigValues,
  'steal_base_rate' | 'steal_per_rank' | 'steal_max_rate' | 'steal_down_rate'
>

/**
 * The share of the target's wallet a steal takes, in basis points (spec: The
 * amount). `gap` is the thief's rank minus the target's rank: positive when
 * the target is ahead. Players level on the leaderboard (a gap of 0) are not
 * behind each other, so they are robbed at the base rate.
 */
export function stealRate(gap: number, rates: StealRates): number {
  if (gap < 0) return rates.steal_down_rate
  return Math.min(rates.steal_max_rate, rates.steal_base_rate + rates.steal_per_rank * gap)
}

/** The most a player can lose to steals in a game day: a share of their net worth at the reset. */
export function dailyLossCap(netWorthAtReset: bigint, capPct: number): bigint {
  return netWorthAtReset > 0n ? basisPoints(netWorthAtReset, capPct) : 0n
}

/** What is left of a player's daily loss cap. Never below zero. */
export function capLeft(netWorthAtReset: bigint, stolenToday: bigint, capPct: number): bigint {
  const left = dailyLossCap(netWorthAtReset, capPct) - stolenToday
  return left > 0n ? left : 0n
}

/** What a successful steal takes: the rate of the target's wallet, rounded down, within the cap. */
export function stealAmount(targetWallet: bigint, rate: number, left: bigint): bigint {
  if (targetWallet <= 0n || left <= 0n) return 0n
  const raw = basisPoints(targetWallet, rate)
  return raw < left ? raw : left
}

/** What a failed steal costs the thief: a share of their own wallet, paid to the target. */
export function stealFine(thiefWallet: bigint, finePct: number): bigint {
  return thiefWallet > 0n ? basisPoints(thiefWallet, finePct) : 0n
}

/** A share of the wallet with a floor: the price of a shield charge or the extra attempt. */
function priceFrom(wallet: bigint, pct: number, min: bigint): bigint {
  const share = wallet > 0n ? basisPoints(wallet, pct) : 0n
  return share > min ? share : min
}

/** The price of one shield charge: 2% of the buyer's wallet, at least 3 chips (spec: Shields). */
export function shieldPrice(
  wallet: bigint,
  cfg: Pick<ConfigValues, 'shield_price_pct' | 'shield_price_min'>,
): bigint {
  return priceFrom(wallet, cfg.shield_price_pct, cfg.shield_price_min)
}

/** The price of the one extra steal attempt per game day (spec: Shop). */
export function extraAttemptPrice(
  wallet: bigint,
  cfg: Pick<ConfigValues, 'extra_steal_price_pct' | 'extra_steal_price_min'>,
): bigint {
  return priceFrom(wallet, cfg.extra_steal_price_pct, cfg.extra_steal_price_min)
}

/**
 * How much more the vault can take: up to `vault_cap_pct` of net worth,
 * checked at the moment of deposit (spec: Vault). Net worth is the wallet
 * plus the vault, and a deposit does not change it.
 */
export function vaultRoom(wallet: bigint, vault: bigint, capPct: number): bigint {
  const room = basisPoints(wallet + vault, capPct) - vault
  if (room <= 0n) return 0n
  return room < wallet ? room : wallet
}

/** The most one vault move can take now: the room on a deposit, the whole vault on a withdrawal. */
export function vaultMost(
  direction: VaultDirection,
  wallet: bigint,
  vault: bigint,
  capPct: number,
): bigint {
  if (direction === 'deposit') return vaultRoom(wallet, vault, capPct)
  return vault > 0n ? vault : 0n
}

export type VaultAmountResult = { ok: true; amount: bigint } | { ok: false; error: string }

/**
 * Reads a typed vault amount the way the bet box reads a bet: 20, 12.50,
 * 2.5k, or the words `max` and `all` (as much as this move allows) and
 * `half` (half of that). The browser previews it; the server reads the same
 * text again against the locked wallet.
 */
export function parseVaultAmount(
  text: string,
  direction: VaultDirection,
  wallet: bigint,
  vault: bigint,
  capPct: number,
): VaultAmountResult {
  const most = vaultMost(direction, wallet, vault, capPct)
  const word = text.trim().toLowerCase().replace(/\s+/g, '')
  if (word === 'max' || word === 'all' || word === 'allin' || word === 'all-in') {
    return { ok: true, amount: most }
  }
  if (word === 'half') return { ok: true, amount: most / 2n }
  const parsed = parseBetAmount(text, direction === 'deposit' ? wallet : vault)
  if (!parsed.ok) {
    return { ok: false, error: parsed.error.replace('50, 2.5k, half or all', '20, half or max') }
  }
  return { ok: true, amount: parsed.amount }
}

export interface VaultProblem {
  code: 'vault_empty' | 'wallet_empty' | 'vault_full' | 'insufficient_funds' | 'zero'
  message: string
}

/** Why a vault move of `amount` cannot happen, or null when it can (spec: Vault). */
export function vaultMoveProblem(
  direction: VaultDirection,
  amount: bigint,
  wallet: bigint,
  vault: bigint,
  capPct: number,
): VaultProblem | null {
  const deposit = direction === 'deposit'
  const room = vaultRoom(wallet, vault, capPct)
  const full = `Your vault is full: it can hold up to ${formatShare(capPct)} of your net worth.`
  if (amount <= 0n) {
    if (!deposit && vault <= 0n) return { code: 'vault_empty', message: 'Your vault is empty.' }
    if (deposit && wallet <= 0n) return { code: 'wallet_empty', message: 'Your wallet is empty.' }
    if (deposit && room <= 0n) return { code: 'vault_full', message: full }
    return { code: 'zero', message: 'Type an amount above zero.' }
  }
  if (deposit && amount > wallet) {
    return {
      code: 'insufficient_funds',
      message: `You only have ${chipCount(wallet)} in your wallet.`,
    }
  }
  if (!deposit && amount > vault) {
    return {
      code: 'insufficient_funds',
      message: vault > 0n ? `Your vault only has ${chipCount(vault)}.` : 'Your vault is empty.',
    }
  }
  if (deposit && amount > room) {
    return {
      code: 'vault_full',
      message:
        room > 0n
          ? `Your vault can take ${chipCount(room)} more right now: up to ${formatShare(capPct)} of your net worth.`
          : full,
    }
  }
  return null
}

/** Steal attempts a player has in a game day: the free ones, plus one if they bought the extra. */
export function attemptsAllowed(freePerDay: number, extraBought: boolean): number {
  return freePerDay + (extraBought ? 1 : 0)
}

const DAYS_PER_WEEK = 7

/**
 * The season week `now` falls in, for the weekly shield limit: weeks of seven
 * game days counted from the season's first game day (4:00 AM Central).
 */
export function seasonWeek(
  seasonStartsAt: Date,
  now: Date,
): { index: number; start: Date; end: Date } {
  const first = gameDay(seasonStartsAt)
  const index = Math.max(0, Math.floor((seasonDay(seasonStartsAt, now) - 1) / DAYS_PER_WEEK))
  return {
    index,
    start: gameDayStart(addGameDays(first, index * DAYS_PER_WEEK)),
    end: gameDayStart(addGameDays(first, (index + 1) * DAYS_PER_WEEK)),
  }
}

// ---------------------------------------------------------------- who can be robbed

/**
 * Why a player cannot be robbed right now (spec: Steal rules, rule 2), most
 * general first: the season, the thief's own attempts, then the target.
 */
export const TARGET_BLOCKS = [
  'no_season',
  'freeze',
  'self',
  'unknown',
  'no_attempts',
  'tried',
  'immune',
  'floor',
  'cap',
  'empty',
] as const
export type TargetBlock = (typeof TARGET_BLOCKS)[number]

export interface TargetFacts {
  /** Where the season is by its clock. Steals run only while it is `open`. */
  phase: SeasonPhase | null
  thief: { id: string; rank: number }
  /** Null when the player is not on this season's leaderboard. */
  target: { id: string; rank: number; balance: bigint; netWorth: bigint } | null
  attemptsLeft: number
  triedToday: boolean
  /** Epoch ms, or null. */
  immuneUntil: number | null
  /** Epoch ms: database time on the server, the corrected clock in the browser. */
  now: number
  /** Hundredths left of the target's daily loss cap. */
  capLeft: bigint
  cfg: StealRates & Pick<ConfigValues, 'steal_floor' | 'steal_success_pct' | 'steal_fine_pct'>
}

export type TargetCheck =
  { ok: true; gap: number; rate: number; amount: bigint } | { ok: false; reason: TargetBlock }

/** Whether the target can be robbed, and if so what a success would take. */
export function checkTarget(f: TargetFacts): TargetCheck {
  if (f.phase === null || f.phase === 'upcoming' || f.phase === 'over') {
    return { ok: false, reason: 'no_season' }
  }
  if (f.phase === 'final_day') return { ok: false, reason: 'freeze' }
  if (f.target?.id === f.thief.id) return { ok: false, reason: 'self' }
  if (!f.target) return { ok: false, reason: 'unknown' }
  if (f.attemptsLeft <= 0) return { ok: false, reason: 'no_attempts' }
  if (f.triedToday) return { ok: false, reason: 'tried' }
  if (f.immuneUntil !== null && f.immuneUntil > f.now) return { ok: false, reason: 'immune' }
  if (f.target.netWorth < f.cfg.steal_floor) return { ok: false, reason: 'floor' }
  if (f.capLeft <= 0n) return { ok: false, reason: 'cap' }
  const gap = f.thief.rank - f.target.rank
  const rate = stealRate(gap, f.cfg)
  const amount = stealAmount(f.target.balance, rate, f.capLeft)
  if (amount <= 0n) return { ok: false, reason: 'empty' }
  return { ok: true, gap, rate, amount }
}

/** The reason in plain words, for the profile card, the target list and the API's refusal. */
export function blockMessage(
  reason: TargetBlock,
  context: {
    name?: string
    freezeHours?: number
    floor?: bigint
    immuneFor?: string
    freePerDay?: number
    canBuyExtra?: boolean
  } = {},
): string {
  const name = context.name ?? 'That player'
  switch (reason) {
    case 'no_season':
      return 'Steals open when the season is running.'
    case 'freeze':
      return `Steals are off for the final ${context.freezeHours ?? 24} hours of the season.`
    case 'self':
      return 'You cannot rob yourself.'
    case 'unknown':
      return 'That player is not in this season.'
    case 'no_attempts':
      return context.canBuyExtra
        ? 'You have no steal attempts left today. Buy one more in the Shop, or wait for 4:00 AM.'
        : 'You have no steal attempts left today. More at 4:00 AM Central.'
    case 'tried':
      return `You already tried to rob ${name} today.`
    case 'immune':
      return context.immuneFor
        ? `${name} is immune for ${context.immuneFor} after the last steal.`
        : `${name} is immune after the last steal.`
    case 'floor':
      return `${name} has under ${context.floor === undefined ? 'the minimum' : chipCount(context.floor)} net worth, too little to rob.`
    case 'cap':
      return `${name} has lost all they can to steals today.`
    case 'empty':
      return `${name} has nothing in their wallet to take.`
  }
}

/** A short label for a locked target, for tight spaces such as a list row. */
export const BLOCK_LABELS: Record<TargetBlock, string> = {
  no_season: 'Closed',
  freeze: 'Final day',
  self: 'You',
  unknown: 'Not playing',
  no_attempts: 'No attempts',
  tried: 'Tried today',
  immune: 'Immune',
  floor: 'Too poor',
  cap: 'Hit daily cap',
  empty: 'Empty wallet',
}

/** "Takes 1.8% of their wallet" for the odds line. */
export function rateLabel(rate: number): string {
  return `${formatShare(rate)} of their wallet`
}

// ---------------------------------------------------------------- what the API sends

// The attempt as everyone sees it lives in shared code, for the ticker too.
export type { StealResult, StealView } from '../steals.ts'

/** Another player's public heist state, for the target list and the profile card. */
export interface TargetInfo {
  userId: string
  /** ISO, or null when not immune. */
  immuneUntil: string | null
  /** You already tried to rob them this game day. */
  triedToday: boolean
  /** Hundredths left of their daily loss cap. */
  capLeft: number
}

/** GET /api/heist/state: everything the heist widgets draw, for the caller. */
export interface HeistState {
  seasonId: number | null
  phase: SeasonPhase | null
  /** The game day now (YYYY-MM-DD) and when the next one starts (ISO). */
  gameDay: string
  nextResetAt: string
  /** When steals, shields and vault moves stop for the final day (ISO), or null. */
  freezeAt: string | null
  me: {
    attemptsUsed: number
    attemptsAllowed: number
    extraBought: boolean
    /** Your shield charges. Only you ever see this number. */
    charges: number
    immuneUntil: string | null
    shieldsThisWeek: number
    /** When the season week ends and the weekly shield limit starts over (ISO). */
    weekEndsAt: string | null
    vaultMoved: boolean
    /** Hundredths stolen from you this game day, and the most you can lose today. */
    stolenToday: number
    lossCap: number
  }
  targets: TargetInfo[]
}

/** The caller's wallet after a chip-moving request, for the top bar. */
export interface WalletAfter {
  seasonId: number
  balance: number
  vault: number
  /** The latest ledger id. */
  version: number
}

/** POST /api/heist/steal */
export interface StealResponse {
  steal: StealView
  wallet: WalletAfter
  /** The target's immunity it started, after a success or a block. */
  immuneUntil: string | null
  /** The thief's attempts used today, this one included. */
  attemptsUsed: number
}

/** POST /api/heist/shield */
export interface ShieldResponse {
  charges: number
  price: number
  shieldsThisWeek: number
  wallet: WalletAfter
}

/** POST /api/heist/extra-attempt */
export interface ExtraAttemptResponse {
  attemptsAllowed: number
  price: number
  wallet: WalletAfter
}

/** POST /api/heist/vault */
export interface VaultResponse {
  direction: VaultDirection
  amount: number
  wallet: WalletAfter
}

// ---------------------------------------------------------------- live events

/** News of a steal for its target, on their own channel. */
export interface RobbedEvent {
  stealId: number
  thiefId: string
  amount: number
  immuneUntil: string
}

export interface ShieldBlockedEvent {
  stealId: number
  thiefId: string
  /** The charges the target still holds. Sent only to them. */
  charges: number
  immuneUntil: string
}

export interface StealFoiledEvent {
  stealId: number
  thiefId: string
  /** The fine the thief paid to the target. */
  fine: number
}

declare module '../events.ts' {
  interface UserEvents {
    /** You were robbed. Version: the steal id. */
    robbed: RobbedEvent
    /** Your shield blocked a steal. Version: the steal id. */
    'shield.blocked': ShieldBlockedEvent
    /** Someone tried to rob you, failed and paid you the fine. Version: the steal id. */
    'steal.foiled': StealFoiledEvent
    /** Your shields, attempts or vault changed in another tab: refetch the heist state. */
    'heist.changed': { what: 'shield' | 'extra' | 'vault' }
  }
}
