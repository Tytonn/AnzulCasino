/**
 * Roulette (spec: Games > Roulette): a European wheel, 0 to 36 with a single
 * zero, one wheel and one table for everyone. The rules both sides share
 * live here: the table's spots, what each pays, the typed quick bets, the
 * clock every browser spins on, and the round's public detail. The number
 * itself is drawn on the server when betting closes (rule 7, draw late).
 *
 * Every bet returns 36 times its stake divided by the count of numbers it
 * covers: a single number returns 36 (35 to 1), a split 18 (17 to 1), down
 * to red or black at 2 (1 to 1). Each of the 37 pockets is equally likely,
 * so every bet returns 36/37 of its stake on average: the spec's 2.7% edge.
 */
import { z } from 'zod'

import { parseBetAmount } from '../bet-amount.ts'
import { BetText } from '../rounds.ts'

export const ROULETTE = 'roulette'

/** Pockets on the wheel: 0 to 36. */
export const POCKETS = 37

/** A winning bet returns its stake times this, divided by the numbers it covers. */
export const RETURN_NUMERATOR = 36

/** The European wheel's pockets, clockwise from zero. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]

const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
])

export type PocketColor = 'red' | 'black' | 'green'

export function pocketColor(n: number): PocketColor {
  if (n === 0) return 'green'
  return RED_NUMBERS.has(n) ? 'red' : 'black'
}

export const COLOR_NAMES: Record<PocketColor, string> = {
  red: 'Red',
  black: 'Black',
  green: 'Green',
}

/** "17 Red", "0 Green": the ticker's line for a spin. */
export function numberName(n: number): string {
  return `${n} ${COLOR_NAMES[pocketColor(n)]}`
}

// ---------------------------------------------------------------- the table

export type SpotKind =
  | 'straight'
  | 'split'
  | 'street'
  | 'corner'
  | 'line'
  | 'dozen'
  | 'column'
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'low'
  | 'high'

/** The kinds placed only by clicking the table (spec: the quick-bet box). */
export const INSIDE_COMBOS: ReadonlySet<SpotKind> = new Set(['split', 'street', 'corner', 'line'])

/**
 * One place to bet on the table. Its id is what travels and is saved:
 *
 * - a single number: "17", "0"
 * - splits, streets, corners and six lines: their numbers, lowest first,
 *   joined by dashes: "17-20", "13-14-15", "0-1-2", "17-18-20-21", "0-1-2-3",
 *   "13-14-15-16-17-18"
 * - dozens "1st12", "2nd12", "3rd12"; columns "col1" (1, 4 ... 34), "col2",
 *   "col3"; and "red", "black", "odd", "even", "low" (1-18), "high" (19-36)
 */
export interface Spot {
  id: string
  kind: SpotKind
  numbers: readonly number[]
  /** For people: "17", "Split 17/20", "1st 12", "Red". */
  name: string
}

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)

function inside(kind: SpotKind, numbers: number[], name: string): Spot {
  const sorted = [...numbers].sort((a, b) => a - b)
  return { id: sorted.join('-'), kind, numbers: sorted, name }
}

function buildSpots(): Spot[] {
  const spots: Spot[] = []
  for (let n = 0; n <= 36; n++)
    spots.push({ id: String(n), kind: 'straight', numbers: [n], name: String(n) })

  // Splits: side by side in a row of three, one above the other, and zero's three.
  for (let n = 1; n <= 36; n++) {
    if (n % 3 !== 0) spots.push(inside('split', [n, n + 1], `Split ${n}/${n + 1}`))
    if (n <= 33) spots.push(inside('split', [n, n + 3], `Split ${n}/${n + 3}`))
  }
  for (const n of [1, 2, 3]) spots.push(inside('split', [0, n], `Split 0/${n}`))

  // Streets (a row of three), and the two trios with zero.
  for (let row = 0; row < 12; row++) {
    const a = row * 3 + 1
    spots.push(inside('street', [a, a + 1, a + 2], `Street ${a}-${a + 2}`))
  }
  spots.push(inside('street', [0, 1, 2], 'Trio 0/1/2'))
  spots.push(inside('street', [0, 2, 3], 'Trio 0/2/3'))

  // Corners where four numbers meet, and zero's first four.
  for (let n = 1; n <= 32; n++) {
    if (n % 3 === 0) continue
    spots.push(inside('corner', [n, n + 1, n + 3, n + 4], `Corner ${n}/${n + 1}/${n + 3}/${n + 4}`))
  }
  spots.push(inside('corner', [0, 1, 2, 3], 'First four'))

  // Six lines: two streets side by side.
  for (let row = 0; row < 11; row++) {
    const a = row * 3 + 1
    spots.push(inside('line', range(a, a + 5), `Line ${a}-${a + 5}`))
  }

  const ordinal = ['1st', '2nd', '3rd'] as const
  for (let i = 0; i < 3; i++) {
    spots.push({
      id: `${ordinal[i]}12`,
      kind: 'dozen',
      numbers: range(i * 12 + 1, i * 12 + 12),
      name: `${ordinal[i]} 12`,
    })
  }
  for (let i = 0; i < 3; i++) {
    spots.push({
      id: `col${i + 1}`,
      kind: 'column',
      numbers: range(0, 11).map((r) => r * 3 + i + 1),
      name: `${ordinal[i]} column`,
    })
  }
  const evens: [SpotKind, string, number[]][] = [
    ['red', 'Red', range(1, 36).filter((n) => RED_NUMBERS.has(n))],
    ['black', 'Black', range(1, 36).filter((n) => !RED_NUMBERS.has(n))],
    ['odd', 'Odd', range(1, 36).filter((n) => n % 2 === 1)],
    ['even', 'Even', range(1, 36).filter((n) => n % 2 === 0)],
    ['low', '1-18', range(1, 18)],
    ['high', '19-36', range(19, 36)],
  ]
  for (const [kind, name, numbers] of evens) spots.push({ id: kind, kind, numbers, name })
  return spots
}

/** Every place on the table: 157 of them. */
export const SPOTS: readonly Spot[] = buildSpots()

const BY_ID: ReadonlyMap<string, Spot> = new Map(SPOTS.map((s) => [s.id, s]))

export function isSpot(id: string): boolean {
  return BY_ID.has(id)
}

/** The spot with this id. Throws for an id that is not on the table: check with isSpot first. */
export function spotById(id: string): Spot {
  const spot = BY_ID.get(id)
  if (!spot) throw new Error(`Not a roulette spot: ${id}`)
  return spot
}

export function covers(spot: Spot, number: number): boolean {
  return spot.numbers.includes(number)
}

/** What a winning bet pays per chip, not counting the stake: 35 for a single number. */
export function paysTo(spot: Spot): number {
  return RETURN_NUMERATOR / spot.numbers.length - 1
}

/**
 * Everything a bet returns once `number` is drawn, stake included, in
 * chips: the stake times 36 over the numbers it covers, or nothing. 36
 * divides evenly by every spot's count, so nothing is ever rounded.
 */
export function spotReturn(spot: Spot, amount: bigint, number: number): bigint {
  if (!covers(spot, number)) return 0n
  return (amount * BigInt(RETURN_NUMERATOR)) / BigInt(spot.numbers.length)
}

// ---------------------------------------------------------------- a round

/** One bet in a round: a spot and the chips on it. */
export interface RouletteBet {
  spot: string
  amount: number
}

/**
 * A roulette round's public detail: one player's bets on one spin, and
 * once drawn, the number and the spots it won. Enough to replay it.
 */
export interface RouletteDetail {
  /** The spin these bets ride on. */
  spin: number
  /** One entry per spot, in the order first bet on. Empty after the bets are cleared. */
  bets: RouletteBet[]
  /** The winning number, null until the spin is drawn. */
  number: number | null
  /** The player's spots that won, once drawn. */
  wins: string[]
}

/** The stake of a list of bets, in chips. */
export function betsTotal(bets: readonly RouletteBet[]): bigint {
  return bets.reduce((sum, bet) => sum + BigInt(bet.amount), 0n)
}

/** Adds chips to the table: onto an existing spot, or as a new one at the end. */
export function addBets(
  bets: readonly RouletteBet[],
  added: readonly { spot: string; amount: bigint }[],
): RouletteBet[] {
  const next = bets.map((b) => ({ ...b }))
  for (const add of added) {
    const found = next.find((b) => b.spot === add.spot)
    if (found) found.amount = Number(BigInt(found.amount) + add.amount)
    else next.push({ spot: add.spot, amount: Number(add.amount) })
  }
  return next
}

/** Takes `amount` off a spot (all of it when the amount covers it). */
export function removeBet(
  bets: readonly RouletteBet[],
  spot: string,
  amount: bigint,
): RouletteBet[] {
  return bets.flatMap((b) => {
    if (b.spot !== spot) return [{ ...b }]
    const left = BigInt(b.amount) - amount
    return left > 0n ? [{ spot: b.spot, amount: Number(left) }] : []
  })
}

/** Everything a round's bets return once `number` is drawn, and the spots that won. */
export function settleBets(
  bets: readonly RouletteBet[],
  number: number,
): { payout: bigint; wins: string[] } {
  let payout = 0n
  const wins: string[] = []
  for (const bet of bets) {
    const back = spotReturn(spotById(bet.spot), BigInt(bet.amount), number)
    if (back > 0n) {
      payout += back
      wins.push(bet.spot)
    }
  }
  return { payout, wins }
}

// ---------------------------------------------------------------- the clock

/**
 * Rounds run on a fixed cycle (spec: Clock): betting, then the spin, then the
 * result. Times are epoch milliseconds, database time on the server and
 * serverNow() in the browser.
 */
export interface SpinTiming {
  bettingMs: number
  spinMs: number
  resultMs: number
}

export function timingFromConfig(config: {
  roulette_betting_seconds: number
  roulette_spin_seconds: number
  roulette_result_seconds: number
}): SpinTiming {
  return {
    bettingMs: config.roulette_betting_seconds * 1000,
    spinMs: config.roulette_spin_seconds * 1000,
    resultMs: config.roulette_result_seconds * 1000,
  }
}

export function cycleMs(timing: SpinTiming): number {
  return timing.bettingMs + timing.spinMs + timing.resultMs
}

/** One spin's times. */
export interface SpinWindow {
  spin: number
  /** Betting opens. */
  opensAt: number
  /** Betting closes, the number is drawn and the wheel starts to spin. */
  closesAt: number
  /** The ball comes to rest. */
  landsAt: number
  /** The result has shown; the next spin opens. */
  endsAt: number
}

export function spinWindow(spin: number, opensAt: number, timing: SpinTiming): SpinWindow {
  const closesAt = opensAt + timing.bettingMs
  const landsAt = closesAt + timing.spinMs
  return { spin, opensAt, closesAt, landsAt, endsAt: landsAt + timing.resultMs }
}

/**
 * Where the wheel's schedule stands: one spin whose times are known, after
 * which spins follow back to back at `timing`. With no spin saved yet this
 * season, the anchor is spin -1 ending at the season's start, so spin n opens
 * at start + n * cycle: the spec's floor((time - season start) / cycle). The
 * server anchors on the latest saved spin, so an admin changing the timings
 * mid-season moves the schedule forward from there instead of renumbering
 * spins that already ran.
 */
export interface RouletteClock {
  anchor: SpinWindow
  timing: SpinTiming
}

/** The clock for a season with no spin saved yet. */
export function seasonClock(startsAt: number, timing: SpinTiming): RouletteClock {
  return { anchor: spinWindow(-1, startsAt - cycleMs(timing), timing), timing }
}

/** The spin running at time `t`: in betting, spinning or showing its result. */
export function spinAt(clock: RouletteClock, t: number): SpinWindow {
  const { anchor, timing } = clock
  if (t < anchor.endsAt) return anchor
  const cycle = cycleMs(timing)
  const k = Math.floor((t - anchor.endsAt) / cycle)
  return spinWindow(anchor.spin + 1 + k, anchor.endsAt + k * cycle, timing)
}

export type SpinPhase = 'betting' | 'spinning' | 'result'

export function phaseAt(window: SpinWindow, t: number): SpinPhase {
  if (t < window.closesAt) return 'betting'
  if (t < window.landsAt) return 'spinning'
  return 'result'
}

// ---------------------------------------------------------------- the API

/** A spot id in an endpoint's input. */
export const SpotId = z
  .string({ error: 'Pick a place on the table.' })
  .max(24, 'That is not a place on the table.')
  .refine(isSpot, { error: 'That is not a place on the table.' })

const SpinNo = z
  .number({ error: 'Say which spin the bet is for.' })
  .int('Say which spin the bet is for.')
  .min(0, 'Say which spin the bet is for.')
  .max(Number.MAX_SAFE_INTEGER, 'Say which spin the bet is for.')

/** One request can carry every spot on the table: a repeat of a full table. */
export const MAX_BETS_PER_REQUEST = SPOTS.length

/**
 * POST /api/roulette/bet: one or more bets on the spin taking bets now. Each
 * amount is typed text ("50", "2.5k", "half", "all"), resolved on the server
 * against what is left in the wallet as each bet goes down.
 */
export const RouletteBetInput = z.strictObject({
  spin: SpinNo,
  bets: z
    .array(z.strictObject({ spot: SpotId, bet: BetText }), { error: 'Place at least one bet.' })
    .min(1, 'Place at least one bet.')
    .max(MAX_BETS_PER_REQUEST, 'That is more bets than the table has places.'),
})
export type RouletteBetInput = z.infer<typeof RouletteBetInput>

/** POST /api/roulette/remove: takes chips off one spot (all of them without an amount). */
export const RouletteRemoveInput = z.strictObject({
  spin: SpinNo,
  spot: SpotId,
  /** Chips. */
  amount: z
    .number()
    .int('Take off a whole number of chips.')
    .positive('Take off more than zero.')
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
})
export type RouletteRemoveInput = z.infer<typeof RouletteRemoveInput>

/** POST /api/roulette/clear: takes every bet off the spin. */
export const RouletteClearInput = z.strictObject({ spin: SpinNo })

/** POST /api/roulette/settle: draws a spin whose betting has closed, or reads its result. */
export const RouletteSettleInput = z.strictObject({ spin: SpinNo })

/** A spin's result, as saved and as browsers see it. */
export interface SpinResult {
  spin: number
  number: number
  /** Epoch ms when it was drawn. */
  drawnAt: number
}

/** POST /api/roulette/settle */
export type SettleResponse =
  | { state: 'drawn'; result: SpinResult; window: SpinWindow }
  /** Nobody bet: the wheel does not spin and nothing is saved. */
  | { state: 'empty'; spin: number }
  /** Betting is still open: try again at `closesAt`. */
  | { state: 'open'; spin: number; closesAt: number }

/** GET /api/roulette/table: the schedule and the last numbers. */
export interface RouletteTable {
  /** Null when no season has run yet. */
  clock: RouletteClock | null
  /** The latest results, newest first. */
  recent: SpinResult[]
}

/** How many results the strip under the wheel shows (spec: the last 12 numbers). */
export const RECENT_RESULTS = 12

/**
 * `round.result` on room:roulette: the number for a spin, the moment it is
 * drawn, and the schedule from here on so every browser stays on the server's
 * clock. The wheel slows onto the number at `window.landsAt`.
 */
export interface RouletteResultEvent {
  result: SpinResult
  window: SpinWindow
  clock: RouletteClock
}

declare module '../events.ts' {
  interface RoomEvents {
    /** Roulette: a spin's number is drawn. Version: the spin number. */
    'round.result': RouletteResultEvent
  }
}

// ---------------------------------------------------------------- the quick-bet box

/**
 * Spaces the quick-bet box understands (spec: Quick-bet box), with a few
 * friendly spellings. Splits, streets, corners and six lines are click-only.
 */
const SPACE_WORDS: Record<string, string> = {
  red: 'red',
  reds: 'red',
  black: 'black',
  blacks: 'black',
  odd: 'odd',
  odds: 'odd',
  even: 'even',
  evens: 'even',
  low: 'low',
  '1-18': 'low',
  '1to18': 'low',
  high: 'high',
  '19-36': 'high',
  '19to36': 'high',
  zero: '0',
  green: '0',
  '1-12': '1st12',
  '1st12': '1st12',
  first12: '1st12',
  '1stdozen': '1st12',
  firstdozen: '1st12',
  dozen1: '1st12',
  '13-24': '2nd12',
  '2nd12': '2nd12',
  second12: '2nd12',
  '2nddozen': '2nd12',
  seconddozen: '2nd12',
  dozen2: '2nd12',
  '25-36': '3rd12',
  '3rd12': '3rd12',
  third12: '3rd12',
  '3rddozen': '3rd12',
  thirddozen: '3rd12',
  dozen3: '3rd12',
  '1st': 'col1',
  first: 'col1',
  '1stcol': 'col1',
  '1stcolumn': 'col1',
  firstcolumn: 'col1',
  col1: 'col1',
  column1: 'col1',
  '2nd': 'col2',
  second: 'col2',
  '2ndcol': 'col2',
  '2ndcolumn': 'col2',
  secondcolumn: 'col2',
  col2: 'col2',
  column2: 'col2',
  '3rd': 'col3',
  third: 'col3',
  '3rdcol': 'col3',
  '3rdcolumn': 'col3',
  thirdcolumn: 'col3',
  col3: 'col3',
  column3: 'col3',
}

const SPACE_HELP =
  'Try a number from 0 to 36, red, black, odd, even, 1-18, 19-36, 1-12, 13-24, 25-36, 1st, 2nd or 3rd.'

export type SpaceResult = { ok: true; spot: string } | { ok: false; error: string }

/** Reads a typed space: "17", "red", "2nd", "13-24". */
export function parseSpace(text: string): SpaceResult {
  const shown = text.trim()
  const key = shown
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[.!]+$/, '')
  if (!key) return { ok: false, error: `Say where the bet goes. ${SPACE_HELP}` }
  if (/^\d{1,2}$/.test(key)) {
    const n = Number(key)
    if (key === '00') {
      return { ok: false, error: 'This wheel has a single zero, so there is no 00. Bet on 0.' }
    }
    if (n <= 36) return { ok: true, spot: String(n) }
    return { ok: false, error: `${shown} is not on the wheel. Numbers go from 0 to 36.` }
  }
  const word = SPACE_WORDS[key]
  if (word) return { ok: true, spot: word }
  const combo = key.split(/[-/]/).map(Number)
  if (combo.length > 1 && combo.every((n) => Number.isInteger(n))) {
    const id = [...combo].sort((a, b) => a - b).join('-')
    const spot = BY_ID.get(id)
    if (spot && INSIDE_COMBOS.has(spot.kind)) {
      return {
        ok: false,
        error: `Splits, streets, corners and six lines go down by clicking the table, between the numbers.`,
      }
    }
  }
  return { ok: false, error: `"${shown}" is not a place on the table. ${SPACE_HELP}` }
}

/** One typed bet: the amount as typed (null when only a space was typed) and the spot. */
export interface QuickBet {
  amount: string | null
  spot: string
}

export type QuickBetResult =
  | { ok: true; bets: QuickBet[] }
  /** Only an amount: the chip size for clicking the table. */
  | { ok: true; bets: []; amount: string }
  | { ok: false; error: string }

const AMOUNT_TOKEN = /^(?:all|allin|all-in|half|max|\d[\d,]*(?:\.\d*)?[kmb]?|\.\d+[kmb]?)$/i

function isAmount(token: string): boolean {
  return AMOUNT_TOKEN.test(token) && parseBetAmount(token, 0n).ok
}

function parseOne(text: string): { ok: true; bet: QuickBet } | { ok: false; error: string } {
  const tokens = text.trim().split(/\s+/)
  const first = tokens[0] ?? ''
  const last = tokens.at(-1) ?? ''
  if (tokens.length === 1) {
    const space = parseSpace(first)
    if (space.ok) return { ok: true, bet: { amount: null, spot: space.spot } }
    return space
  }
  // The documented order is "<amount> <space>"; "<space> <amount>" works when
  // only that reading makes sense ("red 50", or "17 50").
  if (isAmount(first)) {
    const space = parseSpace(tokens.slice(1).join(' '))
    if (space.ok) return { ok: true, bet: { amount: first, spot: space.spot } }
    if (isAmount(last)) {
      const flipped = parseSpace(tokens.slice(0, -1).join(' '))
      if (flipped.ok) return { ok: true, bet: { amount: last, spot: flipped.spot } }
    }
    return space
  }
  if (isAmount(last)) {
    const space = parseSpace(tokens.slice(0, -1).join(' '))
    if (space.ok) return { ok: true, bet: { amount: last, spot: space.spot } }
    return space
  }
  return {
    ok: false,
    error: `Type an amount and a place, like "50 red" or "all 17".`,
  }
}

/**
 * Reads the quick-bet box (spec: Quick-bet box): "<amount> <space>", such as
 * "200 odd", "600 2nd", "50 17" or "all red". Several bets can go in one line,
 * split by commas or semicolons: "50 red, 10 17". A lone number ("25",
 * "2.5k") sets the chip size for clicking; a lone place ("red") bets the chip
 * size there. Amounts stay as typed: the server resolves them against the
 * wallet.
 */
export function parseQuickBet(text: string): QuickBetResult {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'Type a bet, like "50 red" or "all 17".' }
  if (/^[\d.][\d,.]*[kmb]?$/i.test(trimmed) && isAmount(trimmed)) {
    return { ok: true, bets: [], amount: trimmed }
  }
  if (isAmount(trimmed)) {
    return { ok: false, error: `Say where it goes, like "${trimmed.toLowerCase()} red".` }
  }
  // Commas inside a number ("1,000") are thousands separators, not splits.
  const parts = trimmed
    .split(/\s*;\s*|(?<!\d),|,(?!\d)/)
    .map((p) => p.trim())
    .filter(Boolean)
  const bets: QuickBet[] = []
  for (const part of parts) {
    const one = parseOne(part)
    if (!one.ok) return one
    bets.push(one.bet)
  }
  return { ok: true, bets }
}
