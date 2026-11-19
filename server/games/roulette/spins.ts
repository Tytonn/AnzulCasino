/**
 * Roulette's spins: one shared round for the whole table, saved in
 * shared_rounds (docs/LANE_GUIDE.md section 8), and each player's bets on it
 * in one game round of theirs.
 *
 * - A spin's row is created by its first bet, so a spin nobody bets on saves
 *   nothing and the wheel does not spin (spec: Empty rounds).
 * - Every bet locks the row (for share) and is refused unless the database
 *   clock is before its close, so a bet either lands before the draw or is
 *   refused.
 * - The first request after the close locks the row (for update), draws the
 *   number and pays every bet in the same transaction. Every later request
 *   finds the result saved and only reads it. The unique key on the spin
 *   number means one draw per spin.
 *
 * Locks are always taken in the same order: the spin, then the players'
 * rounds, then their wallets in user id order. So a bet on the next spin and
 * the settle of the last one never wait on each other in a circle.
 */
import { and, desc, eq, sql } from 'drizzle-orm'

import { gameRounds, seasons, sharedRounds } from '../../../db/schema/core.ts'
import { roomChannel } from '../../../shared/events.ts'
import {
  numberName,
  ROULETTE,
  type RouletteClock,
  type RouletteDetail,
  type SpinResult,
  type SpinTiming,
  type SpinWindow,
  settleBets,
  spinAt,
  timingFromConfig,
} from '../../../shared/games/roulette.ts'
import { db, dbNow, type Executor, rows, type Tx } from '../../lib/db.ts'
import { ApiError } from '../../lib/errors.ts'
import { liveEvent } from '../../lib/live.ts'
import {
  defineServerGame,
  lockRound,
  type RoundTx,
  roundTransaction,
  settleRound,
} from '../../lib/rounds.ts'
import { requireBetsOpen } from '../../lib/seasons.ts'
import { lockWallets } from '../../lib/wallet.ts'
import { clockFrom, drawNumber, savedWindow, type StoredSpin, windowOf } from './rules.ts'

export const roulette = defineServerGame({ id: ROULETTE, name: 'Roulette' })

/** A spin row's states. */
export type SpinState = 'betting' | 'settled'

const spinColumns = {
  id: sharedRounds.id,
  seasonId: sharedRounds.seasonId,
  roundNo: sharedRounds.roundNo,
  state: sharedRounds.state,
  opensAt: sharedRounds.opensAt,
  closesAt: sharedRounds.closesAt,
  result: sharedRounds.result,
  settledAt: sharedRounds.settledAt,
}

export type SpinRow = Pick<typeof sharedRounds.$inferSelect, keyof typeof spinColumns>

function spinKey(seasonId: number, spin: number) {
  return and(
    eq(sharedRounds.seasonId, seasonId),
    eq(sharedRounds.game, ROULETTE),
    eq(sharedRounds.roundNo, spin),
  )
}

/** The season's latest saved spins, newest first. */
export async function latestSpins(
  executor: Executor,
  seasonId: number,
  limit: number,
): Promise<SpinRow[]> {
  return executor
    .select(spinColumns)
    .from(sharedRounds)
    .where(and(eq(sharedRounds.seasonId, seasonId), eq(sharedRounds.game, ROULETTE)))
    .orderBy(desc(sharedRounds.roundNo))
    .limit(limit)
}

async function seasonStart(executor: Executor, seasonId: number): Promise<Date> {
  const [season] = await executor
    .select({ startsAt: seasons.startsAt })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
  if (!season) throw new ApiError(409, 'no_season', 'There is no season running right now.')
  return season.startsAt
}

/** The wheel's schedule for a season, at the timings in force now. */
export async function scheduleFor(
  executor: Executor,
  seasonId: number,
  timing: SpinTiming,
): Promise<RouletteClock> {
  const [latest] = await latestSpins(executor, seasonId, 1)
  return clockFrom(latest ?? null, await seasonStart(executor, seasonId), timing)
}

/** A drawn spin's result, from its row. */
export function spinResult(row: SpinRow): SpinResult | null {
  const number = (row.result as Partial<StoredSpin> | null)?.number
  if (row.settledAt === null || typeof number !== 'number') return null
  return { spin: row.roundNo, number, drawnAt: row.settledAt.getTime() }
}

/** Refused bets carry the schedule, so the browser puts itself right. */
function spinClosed(clock: RouletteClock, early = false): ApiError {
  return early
    ? new ApiError(409, 'spin_not_open', 'That spin is not taking bets yet. Wait for the wheel.', {
        clock,
      })
    : new ApiError(
        409,
        'spin_closed',
        'Too late: betting on that spin has closed. Bet on the next one.',
        { clock },
      )
}

/**
 * The spin taking bets now, locked for share, created if this is its first
 * bet. Refuses a bet for any other spin (a browser whose clock ran behind or
 * ahead), after the close, and outside the season.
 */
export async function joinSpin(
  tx: Tx,
  seasonId: number,
  wanted: number,
  timing: SpinTiming,
): Promise<SpinRow> {
  await requireBetsOpen(tx, seasonId)
  const now = (await dbNow(tx)).getTime()
  const clock = await scheduleFor(tx, seasonId, timing)
  const window = spinAt(clock, now)
  if (wanted > window.spin) throw spinClosed(clock, true)
  if (wanted < window.spin || now >= window.closesAt) throw spinClosed(clock)

  if (clock.anchor.spin !== window.spin) {
    const stored: StoredSpin = { timing, number: null }
    await tx
      .insert(sharedRounds)
      .values({
        seasonId,
        game: ROULETTE,
        roundNo: window.spin,
        state: 'betting' satisfies SpinState,
        opensAt: new Date(window.opensAt),
        closesAt: new Date(window.closesAt),
        result: stored,
      })
      .onConflictDoNothing()
  }
  return lockOpenSpin(tx, seasonId, window.spin, timing)
}

/** A spin still taking bets, locked for share. For changing bets on it. */
export async function lockOpenSpin(
  tx: Tx,
  seasonId: number,
  spin: number,
  timing: SpinTiming,
): Promise<SpinRow> {
  const [row] = await tx
    .select({ ...spinColumns, open: sql<boolean>`now() < ${sharedRounds.closesAt}` })
    .from(sharedRounds)
    .where(spinKey(seasonId, spin))
    .for('share')
  if (!row || row.settledAt !== null || row.state !== 'betting' || !row.open) {
    throw spinClosed(await scheduleFor(tx, seasonId, timing))
  }
  return row
}

/**
 * Takes one player's bets one at a time, so two quick requests never both
 * try to open their round on a spin. Held until the transaction ends. A bet
 * takes it after locking the spin and before the player's round; settling
 * never asks for it, so it cannot close a circle of waits.
 */
export async function lockPlayerBets(tx: Tx, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ROULETTE}:${userId}`}, 0))`,
  )
}

function storedTiming(row: { result: unknown }): SpinTiming | null {
  return (row.result as Partial<StoredSpin> | null)?.timing ?? null
}

// ---------------------------------------------------------------- the draw

/** What settling a spin found or did. */
export type SettleOutcome =
  | { state: 'drawn'; result: SpinResult; window: SpinWindow; drew: boolean }
  /** Betting is still open: try again at `closesAt`. */
  | { state: 'open'; spin: number; closesAt: number }
  /** No row: nobody bet on it (or its first bet has not committed yet). */
  | { state: 'none'; spin: number }

/**
 * Draws a spin whose betting has closed and pays every bet on it, in the
 * caller's transaction, or reads the result if it is already drawn.
 */
export async function settleSpinIn(
  rt: RoundTx,
  seasonId: number,
  spin: number,
): Promise<SettleOutcome> {
  const timing = timingFromConfig(rt.config)
  const [row] = await rt.tx
    .select({ ...spinColumns, due: sql<boolean>`now() >= ${sharedRounds.closesAt}` })
    .from(sharedRounds)
    .where(spinKey(seasonId, spin))
    .for('update')
  if (!row) return { state: 'none', spin }
  const window = savedWindow(row, timing)
  const saved = spinResult(row)
  if (saved) return { state: 'drawn', result: saved, window, drew: false }
  if (!row.due) return { state: 'open', spin, closesAt: window.closesAt }

  // Draw late: the number exists from this moment on, and no bet can join
  // the spin any more (bets lock the row for share and check the close).
  const number = drawNumber()
  const stored: StoredSpin = { timing: storedTiming(row) ?? timing, number }
  const [drawn] = await rt.tx
    .update(sharedRounds)
    .set({ state: 'settled' satisfies SpinState, result: stored, settledAt: sql`now()` })
    .where(eq(sharedRounds.id, row.id))
    .returning({ settledAt: sharedRounds.settledAt })
  const drawnAt = drawn?.settledAt ?? new Date()
  const result: SpinResult = { spin, number, drawnAt: drawnAt.getTime() }

  // The number first, so the wheel can start slowing onto it, then each
  // player's result, which the room shows when the ball lands.
  const clock = await scheduleFor(rt.tx, seasonId, timing)
  rt.emit(liveEvent(roomChannel(ROULETTE), 'round.result', { result, window, clock }, spin))

  const open = await rt.tx
    .select({ id: gameRounds.id })
    .from(gameRounds)
    .where(and(eq(gameRounds.sharedRoundId, row.id), eq(gameRounds.status, 'open')))
    .orderBy(gameRounds.userId)
  const rounds = []
  for (const { id } of open) {
    const round = await lockRound<RouletteDetail>(rt.tx, id)
    if (round?.status === 'open') rounds.push(round)
  }
  await lockWallets(
    rt.tx,
    seasonId,
    rounds.map((r) => r.userId),
  )
  for (const round of rounds) {
    const { payout, wins } = settleBets(round.detail.bets, number)
    await settleRound(rt, roulette, round, {
      payout,
      detail: { ...round.detail, number, wins },
      summary: numberName(number),
    })
  }
  return { state: 'drawn', result, window, drew: true }
}

/** Settles one spin in its own transaction. Its news goes out after the commit. */
export function settleSpin(
  waitUntil: (promise: Promise<unknown>) => void,
  seasonId: number,
  spin: number,
): Promise<SettleOutcome> {
  return roundTransaction(waitUntil, (rt) => settleSpinIn(rt, seasonId, spin))
}

/** How far back the lazy settle looks: a spin left unsettled is nearly always among the latest. */
const DUE_LOOKBACK = 50

/**
 * Settles the season's spins whose betting has closed but which nobody has
 * settled yet, such as a spin whose only bettor closed the tab. Called from
 * every roulette request, so no timer has to wake the database.
 */
export async function settleDueSpins(
  waitUntil: (promise: Promise<unknown>) => void,
  seasonId: number,
): Promise<number> {
  const due = await rows<{ round_no: string }>(
    db(),
    sql`select round_no from (
          select ${sharedRounds.roundNo} as round_no, ${sharedRounds.settledAt} as settled_at,
                 ${sharedRounds.closesAt} as closes_at
          from ${sharedRounds}
          where ${sharedRounds.seasonId} = ${seasonId} and ${sharedRounds.game} = ${ROULETTE}
          order by ${sharedRounds.roundNo} desc
          limit ${DUE_LOOKBACK}
        ) recent
        where settled_at is null and closes_at <= now()
        order by round_no`,
  )
  let settled = 0
  for (const { round_no } of due) {
    try {
      const outcome = await settleSpin(waitUntil, seasonId, Number(round_no))
      if (outcome.state === 'drawn' && outcome.drew) settled++
    } catch (error) {
      // One stuck spin must not keep everyone out of the room.
      console.error(`[roulette] could not settle spin ${round_no}`, error)
    }
  }
  return settled
}

/**
 * The backup sweep (spec: Settlement): every season's spins left unsettled,
 * oldest first. The daily scheduled function calls it.
 */
export async function sweepUnsettledSpins(
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<number> {
  const due = await db()
    .select({ seasonId: sharedRounds.seasonId, roundNo: sharedRounds.roundNo })
    .from(sharedRounds)
    .where(
      and(
        eq(sharedRounds.game, ROULETTE),
        sql`${sharedRounds.settledAt} is null`,
        sql`${sharedRounds.closesAt} <= now()`,
      ),
    )
    .orderBy(sharedRounds.closesAt)
    .limit(500)
  let settled = 0
  for (const { seasonId, roundNo } of due) {
    try {
      const outcome = await settleSpin(waitUntil, seasonId, roundNo)
      if (outcome.state === 'drawn' && outcome.drew) settled++
    } catch (error) {
      console.error(`[roulette] sweep could not settle spin ${seasonId}/${roundNo}`, error)
    }
  }
  return settled
}

/** The times of a spin on the current schedule, saved or not. Null for a spin before the anchor. */
export async function spinTimes(
  executor: Executor,
  seasonId: number,
  spin: number,
  timing: SpinTiming,
): Promise<SpinWindow | null> {
  return windowOf(await scheduleFor(executor, seasonId, timing), spin)
}
