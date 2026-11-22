/**
 * Rounds as both sides see them (spec: The room model). Every game's rounds
 * live in one table and move through the same states: `start` takes the
 * stake, zero or more actions follow, `settle` pays out.
 */
import { z } from 'zod'

import type { ChatMessage } from './chat.ts'

/** Every round of every game moves through these states. */
export const ROUND_STATUSES = ['open', 'settled', 'void'] as const
export type RoundStatus = (typeof ROUND_STATUSES)[number]

/**
 * A round as the browser receives it, in API responses and room events.
 * Never holds the round's secret. `D` is the game's own public detail type.
 */
export interface RoundView<D = unknown> {
  id: number
  game: string
  userId: string
  status: RoundStatus
  /** Chips. Grows if the game takes more stake mid-round (a double down). */
  stake: number
  /** Everything paid back, stake included. Null while open. */
  payout: number | null
  /** Hundredths of a multiplier (250 is 2.50x). Null while open. */
  multiplier: number | null
  /** The game's public state: enough to draw the round and to replay it. */
  detail: D
  /** One line for the ticker and History, such as "Heads". Null while open. */
  summary: string | null
  /** An all-in, or a stake at or above big_bet_pct of net worth: the seat glows. */
  bigBet: boolean
  allIn: boolean
  /** Counts the round's changes: 0 at the start, one more for each action and the settle. */
  steps: number
  startedAt: string
  settledAt: string | null
}

/** More changes than any round can have. */
export const ROUND_STEP_LIMIT = 2 ** 20

/**
 * The version a round's room events and fetched views carry. A player's
 * seat shows their latest round, and a later round always has a larger id,
 * so one number orders every change to a seat: a browser keeps whichever
 * of the event and the fetch is newer.
 */
export function roundVersion(round: { id: number; steps: number }): number {
  return round.id * ROUND_STEP_LIMIT + Math.min(round.steps, ROUND_STEP_LIMIT - 1)
}

/**
 * A round the whole table shares (spec: Games, one shared round on one
 * shared card): roulette's spin now, and crash's climb and the race later.
 * Its row in shared_rounds holds the times and the public result, and each
 * player's stake on it is a round of theirs, as in every other game. Its one
 * card in the stream draws this view. Never holds the shared round's secret.
 */
export interface SharedRoundView<D = unknown, R = unknown> {
  /** The shared round's id: what its card and its settle request name. */
  id: number
  game: string
  /** Counts the game's shared rounds in the season: 1, 2, 3 and on. */
  roundNo: number
  /** The game's own states, such as betting and settled. */
  state: string
  /** When it opened: roulette's first bet. */
  opensAt: string
  /** When betting closes. Roulette's moves later with each bet. */
  closesAt: string
  /** When its result was drawn, null until then. */
  settledAt: string | null
  /** The game's public result: roulette's spin time, and its number once drawn. */
  result: R | null
  /** Every player's round on it, in the order they joined. */
  rounds: RoundView<D>[]
  /** sharedRoundVersion(): a browser keeps the newest it has seen. */
  version: number
}

/**
 * The version a shared round's view carries. It grows with every bet (a new
 * round on it, or one more step of a round already on it) and again when the
 * result is drawn, which settles every round on it too. So a browser keeps
 * the newest of the stream page, the live events and its own answers, with
 * nothing stored for it.
 */
export function sharedRoundVersion(view: {
  settledAt: string | Date | null
  rounds: readonly { steps: number }[]
}): number {
  let version = view.settledAt ? 1 : 0
  for (const round of view.rounds) {
    version += 2 * (Math.min(round.steps, ROUND_STEP_LIMIT - 1) + 1)
  }
  return version
}

/**
 * The amount a player types in the bet box, as the API receives it: the
 * text itself ("250", "2.5k", "half", "all"), resolved on the server against
 * the locked wallet (shared/bet-amount.ts).
 */
export const BET_TEXT_MAX = 32

/** The bet text in an endpoint's input schema: `z.strictObject({ bet: BetText, ... })`. */
export const BetText = z
  .string()
  .trim()
  .min(1, 'Type an amount, like 50, 2.5k, half or all.')
  .max(BET_TEXT_MAX, 'That bet is too long to read. Try 50, 2.5k, half or all.')

/** The room as GET /api/<game>/room returns it. */
export interface RoomState<D = unknown> {
  /** Each seated player's open round, or their last one if it settled in the last few minutes. */
  rounds: RoundView<D>[]
}

/** What a game's play and action endpoints return. */
export interface PlayResult<D = unknown> {
  round: RoundView<D>
  /** The player's wallet after the request, so the top bar moves without waiting. */
  wallet: { seasonId: number; balance: number; vault: number; version: number }
  /**
   * The round's card in the stream (spec: The stream), on the request that
   * opened the round, so it shows at once without waiting for the live echo.
   */
  card?: ChatMessage & { round: RoundView<D> }
}
