/**
 * Roulette's spins (spec: Games > Roulette): one round on the wheel for the
 * whole table, saved in shared_rounds (docs/LANE_GUIDE.md section 8), with
 * each player's bets on it in one game round of theirs and one card in the
 * stream for everyone.
 *
 * - There is no clock. A spin opens with its first bet, and every bet while
 *   it is open joins it and moves its close to roulette_close_after_seconds
 *   from now, but never past roulette_max_open_seconds after the first bet.
 * - Every bet takes the table's lock first, so two first bets at once open
 *   one spin, and only the season's latest spin can be open.
 * - A bet joins a spin only while the database clock is before its close,
 *   under the spin row's lock. The first request after the close (a
 *   bettor's settle, the next bet, the lazy catch-up or the daily sweep)
 *   locks the row, draws the number and pays every bet in one transaction.
 *   Every later request finds the number saved and only reads it. The unique
 *   key on season, game and round number means one row, and one draw, per
 *   spin.
 *
 * Locks are always taken in the same order: the table (bets only), the
 * spin, the players' rounds in user id order, then their wallets in user id
 * order. Settling never takes the table's lock, so nothing waits in a circle.
 */
import { and, desc, eq, sql } from 'drizzle-orm'

import { gameRounds, sharedRounds } from '../../../db/schema/core.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import {
  numberName,
  ROULETTE,
  type RouletteDetail,
  type RouletteResult,
  settleBets,
} from '../../../shared/games/roulette.ts'
import { db, rows, type Tx } from '../../lib/db.ts'
import {
  defineServerGame,
  lockRound,
  type RoundTx,
  roundTransaction,
  settleRound,
} from '../../lib/rounds.ts'
import { sharedRoundEvent, sharedRoundView } from '../../lib/shared-rounds.ts'
import { lockWallets } from '../../lib/wallet.ts'
import { drawNumber } from './rules.ts'

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

/** A spin's open times and the wheel's turn, from the settings in force, in seconds and ms. */
export function spinTimes(config: ConfigValues): {
  closeAfter: number
  maxOpen: number
  spinMs: number
} {
  return {
    closeAfter: config.roulette_close_after_seconds,
    maxOpen: config.roulette_max_open_seconds,
    spinMs: config.roulette_spin_seconds * 1000,
  }
}

/** The number a spin has drawn, or null. */
function drawnNumber(row: SpinRow): number | null {
  const number = (row.result as Partial<RouletteResult> | null)?.number
  return row.settledAt !== null && typeof number === 'number' ? number : null
}

/**
 * Takes the table's lock until the transaction ends: one bet at a time opens
 * or joins the season's spin, so there is never more than one open.
 */
async function lockTable(tx: Tx, seasonId: number): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${ROULETTE}:table:${seasonId}`}, 0))`,
  )
}

/** The season's latest spin, locked, and whether its betting has closed by the database clock. */
async function lockLatestSpin(tx: Tx, seasonId: number) {
  const [row] = await tx
    .select({ ...spinColumns, due: sql<boolean>`now() >= ${sharedRounds.closesAt}` })
    .from(sharedRounds)
    .where(and(eq(sharedRounds.seasonId, seasonId), eq(sharedRounds.game, ROULETTE)))
    .orderBy(desc(sharedRounds.roundNo))
    .limit(1)
    .for('update')
  return row ?? null
}

/**
 * The spin a bet goes on: the open one, its close moved to `closeAfter`
 * seconds from now (never earlier than it was, and never past `maxOpen`
 * seconds from its first bet), or a new one when none is open. A spin whose
 * betting has closed but which nobody has settled yet is settled first, in
 * the bet's transaction, so its bettors are paid before the next spin opens.
 * Call it before touching the player's round or wallet.
 */
export async function joinOrOpenSpin(
  rt: RoundTx,
  seasonId: number,
): Promise<{ spin: SpinRow; opened: boolean }> {
  const { tx } = rt
  const times = spinTimes(rt.config)
  await lockTable(tx, seasonId)
  const latest = await lockLatestSpin(tx, seasonId)

  if (latest && latest.settledAt === null && !latest.due) {
    const [moved] = await tx
      .update(sharedRounds)
      .set({
        closesAt: sql`greatest(${sharedRounds.closesAt}, least(
          now() + make_interval(secs => ${times.closeAfter}),
          ${sharedRounds.opensAt} + make_interval(secs => ${times.maxOpen})))`,
      })
      .where(eq(sharedRounds.id, latest.id))
      .returning(spinColumns)
    if (!moved) throw new Error('The open spin went missing')
    return { spin: moved, opened: false }
  }

  if (latest && latest.settledAt === null) await settleSpinIn(rt, latest.id)
  const stored: RouletteResult = { number: null, spinMs: times.spinMs }
  const [opened] = await tx
    .insert(sharedRounds)
    .values({
      seasonId,
      game: ROULETTE,
      roundNo: (latest?.roundNo ?? 0) + 1,
      state: 'betting' satisfies SpinState,
      opensAt: sql`now()`,
      closesAt: sql`now() + make_interval(secs => ${Math.min(times.closeAfter, times.maxOpen)})`,
      result: stored,
    })
    .returning(spinColumns)
  if (!opened) throw new Error('The spin was not saved')
  return { spin: opened, opened: true }
}

// ---------------------------------------------------------------- the draw

/** What settling a spin found or did. */
export type SettleOutcome =
  | { state: 'drawn'; number: number; drew: boolean }
  /** Betting is still open: a later bet moved the close. */
  | { state: 'open'; closesAt: Date }
  /** No roulette spin has that id. */
  | { state: 'none' }

/**
 * Draws a spin whose betting has closed and pays every bet on it, in the
 * caller's transaction, or reads the number if it is already drawn.
 */
export async function settleSpinIn(rt: RoundTx, id: number): Promise<SettleOutcome> {
  const [row] = await rt.tx
    .select({ ...spinColumns, due: sql<boolean>`now() >= ${sharedRounds.closesAt}` })
    .from(sharedRounds)
    .where(and(eq(sharedRounds.id, id), eq(sharedRounds.game, ROULETTE)))
    .for('update')
  if (!row) return { state: 'none' }
  const saved = drawnNumber(row)
  if (saved !== null) return { state: 'drawn', number: saved, drew: false }
  if (row.settledAt !== null) return { state: 'none' }
  if (!row.due) return { state: 'open', closesAt: row.closesAt }

  // Draw late: the number exists from this moment on, and no bet can join
  // the spin any more (a bet locks the row and checks the close first).
  const number = drawNumber()
  const before = row.result as Partial<RouletteResult> | null
  const stored: RouletteResult = {
    number,
    spinMs: before?.spinMs ?? spinTimes(rt.config).spinMs,
  }
  await rt.tx
    .update(sharedRounds)
    .set({ state: 'settled' satisfies SpinState, result: stored, settledAt: sql`now()` })
    .where(eq(sharedRounds.id, row.id))

  const open = await rt.tx
    .select({ id: gameRounds.id })
    .from(gameRounds)
    .where(and(eq(gameRounds.sharedRoundId, row.id), eq(gameRounds.status, 'open')))
    .orderBy(gameRounds.userId)
  const rounds = []
  for (const { id: roundId } of open) {
    const round = await lockRound<RouletteDetail>(rt.tx, roundId)
    if (round?.status === 'open') rounds.push(round)
  }
  await lockWallets(
    rt.tx,
    row.seasonId,
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

  // The card's news: the number and every player's result, which every
  // screen shows once the ball lands.
  const view = await sharedRoundView(rt.tx, row.id)
  if (view) rt.emit(sharedRoundEvent(view))
  return { state: 'drawn', number, drew: true }
}

/** Settles one spin in its own transaction. Its news goes out after the commit. */
export function settleSpin(
  waitUntil: (promise: Promise<unknown>) => void,
  id: number,
): Promise<SettleOutcome> {
  return roundTransaction(waitUntil, (rt) => settleSpinIn(rt, id))
}

/** How far back the lazy settle looks: a spin left unsettled is nearly always among the latest. */
const DUE_LOOKBACK = 50

async function settleEach(
  waitUntil: (promise: Promise<unknown>) => void,
  ids: readonly number[],
  what: string,
): Promise<number> {
  let settled = 0
  for (const id of ids) {
    try {
      const outcome = await settleSpin(waitUntil, id)
      if (outcome.state === 'drawn' && outcome.drew) settled++
    } catch (error) {
      // One stuck spin must not keep everyone off the wheel.
      console.error(`[roulette] ${what} could not settle spin ${id}`, error)
    }
  }
  return settled
}

/**
 * Settles the season's spins whose betting has closed but which nobody has
 * settled yet, such as a spin whose only bettor closed the tab. Called from
 * every roulette request, so no timer has to wake the database.
 */
export async function settleDueSpins(
  waitUntil: (promise: Promise<unknown>) => void,
  seasonId: number,
): Promise<number> {
  const due = await rows<{ id: string }>(
    db(),
    sql`select id from (
          select ${sharedRounds.id} as id, ${sharedRounds.roundNo} as round_no,
                 ${sharedRounds.settledAt} as settled_at, ${sharedRounds.closesAt} as closes_at
          from ${sharedRounds}
          where ${sharedRounds.seasonId} = ${seasonId} and ${sharedRounds.game} = ${ROULETTE}
          order by ${sharedRounds.roundNo} desc
          limit ${DUE_LOOKBACK}
        ) recent
        where settled_at is null and closes_at <= now()
        order by round_no`,
  )
  return settleEach(
    waitUntil,
    due.map((r) => Number(r.id)),
    'the catch-up',
  )
}

/**
 * The backup sweep (spec: Settlement): every season's spins left unsettled,
 * oldest first. The daily scheduled function calls it.
 */
export async function sweepUnsettledSpins(
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<number> {
  const due = await db()
    .select({ id: sharedRounds.id })
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
  return settleEach(
    waitUntil,
    due.map((r) => r.id),
    'the sweep',
  )
}
