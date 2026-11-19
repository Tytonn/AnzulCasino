/**
 * Roulette's endpoints, served by netlify/functions/roulette-api.ts:
 *
 *   GET  /api/roulette/room     each seated player's latest round (useRoom)
 *   GET  /api/roulette/table    the wheel's schedule and the last numbers
 *   POST /api/roulette/bet      { spin, bets: [{ spot, bet }] } -> the round and the wallet
 *   POST /api/roulette/remove   { spin, spot, amount? } -> chips off one spot
 *   POST /api/roulette/clear    { spin } -> every bet off the spin
 *   POST /api/roulette/settle   { spin } -> draws a closed spin, or reads its result
 *
 * A player's bets on one spin are one game round: the first bet starts it,
 * the rest raise it, and taking bets off hands part or all of the stake
 * back. Chips leave the wallet the moment a bet goes down (spec: Bets and
 * payouts). Browsers in the room call settle when betting closes; the first
 * request draws the number and pays everyone, the rest read the result.
 * Every request also settles any closed spin left behind, so nothing waits
 * on a timer (the daily sweep is only a backup).
 */
import {
  addBets,
  RECENT_RESULTS,
  removeBet,
  type RouletteBet,
  RouletteBetInput,
  RouletteClearInput,
  type RouletteDetail,
  RouletteRemoveInput,
  RouletteSettleInput,
  type RouletteTable,
  type SettleResponse,
  type SpinResult,
  spotById,
  timingFromConfig,
} from '../../../shared/games/roulette.ts'
import { formatChips } from '../../../shared/chips.ts'
import { loadConfig } from '../../lib/config.ts'
import { db, dbNow } from '../../lib/db.ts'
import { ApiError, badRequest, conflict } from '../../lib/errors.ts'
import { createApi, route } from '../../lib/http.ts'
import { chipTransaction } from '../../lib/idempotency.ts'
import { type Play, playTransaction, type Round, roomState, roundTx } from '../../lib/rounds.ts'
import { currentSeason } from '../../lib/seasons.ts'
import { lockWallet } from '../../lib/wallet.ts'
import { clockFrom, resolveBets } from './rules.ts'
import {
  joinSpin,
  latestSpins,
  lockOpenSpin,
  lockPlayerBets,
  roulette,
  settleDueSpins,
  settleSpinIn,
  spinResult,
  spinTimes,
  type SpinRow,
} from './spins.ts'

export { roulette }

/** Clicking fast places a lot of bets: twice the usual per-minute limit. */
const BET_LIMIT = { limit: 240, windowSeconds: 60 }

function staleRound(): ApiError {
  return conflict('The last spin is still being paid out. Try again in a moment.', 'spin_settling')
}

/** Settles closed spins left behind, before a request that reads or changes the table. */
async function catchUp(waitUntil: (promise: Promise<unknown>) => void): Promise<void> {
  const season = await currentSeason()
  if (season) await settleDueSpins(waitUntil, season.id)
}

/** The player's open round on this spin, locked, or null. Refuses one left on an older spin. */
async function roundOnSpin(play: Play, spin: SpinRow): Promise<Round<RouletteDetail> | null> {
  const open = await play.current<RouletteDetail>()
  if (open && open.detail.spin !== spin.roundNo) throw staleRound()
  return open
}

/**
 * Takes `off` chips off the table and leaves `bets`: the stake goes down by
 * that much and the round stays open, or with nothing left the whole stake
 * comes back and the round closes.
 */
async function lowerBets(
  play: Play,
  round: Round<RouletteDetail>,
  bets: RouletteBet[],
  off: bigint,
): Promise<Round<RouletteDetail>> {
  if (bets.length === 0) {
    return play.refund(round, { detail: { ...round.detail, bets: [] }, summary: 'Bets taken back' })
  }
  return play.lower(round, { amount: off, detail: { ...round.detail, bets } })
}

export const rouletteRoutes = [
  route({
    method: 'GET',
    path: '/api/roulette/room',
    auth: 'user',
    run: async (ctx) => {
      await catchUp(ctx.waitUntil)
      return roomState(roulette)
    },
  }),

  route({
    method: 'GET',
    path: '/api/roulette/table',
    auth: 'user',
    run: async (ctx): Promise<RouletteTable> => {
      const season = await currentSeason()
      if (!season) return { clock: null, recent: [] }
      await settleDueSpins(ctx.waitUntil, season.id)
      const timing = timingFromConfig(await loadConfig(db()))
      const latest = await latestSpins(db(), season.id, RECENT_RESULTS * 3)
      const recent: SpinResult[] = []
      for (const row of latest) {
        const result = spinResult(row)
        if (result && recent.length < RECENT_RESULTS) recent.push(result)
      }
      return { clock: clockFrom(latest[0] ?? null, season.startsAt, timing), recent }
    },
  }),

  route({
    method: 'POST',
    path: '/api/roulette/bet',
    auth: 'user',
    idempotent: true,
    input: RouletteBetInput,
    limit: BET_LIMIT,
    run: async (ctx) => {
      await catchUp(ctx.waitUntil)
      return playTransaction(ctx, roulette, async (play) => {
        const timing = timingFromConfig(play.config)
        const spin = await joinSpin(play.tx, play.seasonId, ctx.input.spin, timing)
        await lockPlayerBets(play.tx, play.userId)
        const open = await roundOnSpin(play, spin)

        // Each bet is checked against what is left as the ones before it go down.
        const wallet = await lockWallet(play.tx, play.seasonId, play.userId)
        const limits = { minBet: play.config.min_bet, maxBetPct: play.config.max_bet_pct }
        const resolved = resolveBets(ctx.input.bets, wallet.balance, limits)
        if (!resolved.ok) throw badRequest(resolved.error, 'bad_bet')

        if (open) {
          const detail = { ...open.detail, bets: addBets(open.detail.bets, resolved.bets) }
          return play.result(await play.raise(open, { amount: resolved.total, detail }))
        }
        // The first bet opens the round; any others in the request raise it,
        // so each passes the bet limits on its own, as it did above.
        const [first, ...rest] = resolved.bets
        if (!first) throw badRequest('Place at least one bet.', 'bad_bet')
        const detail: RouletteDetail = { spin: spin.roundNo, bets: [], number: null, wins: [] }
        let round = await play.start<RouletteDetail>({
          bet: first.amount,
          detail: { ...detail, bets: addBets([], [first]) },
          sharedRoundId: spin.id,
        })
        if (rest.length > 0) {
          round = await play.raise(round, {
            amount: resolved.total - first.amount,
            detail: { ...round.detail, bets: addBets(round.detail.bets, rest) },
          })
        }
        return play.result(round)
      })
    },
  }),

  route({
    method: 'POST',
    path: '/api/roulette/remove',
    auth: 'user',
    idempotent: true,
    input: RouletteRemoveInput,
    limit: BET_LIMIT,
    run: (ctx) =>
      playTransaction(ctx, roulette, async (play) => {
        const timing = timingFromConfig(play.config)
        const spin = await lockOpenSpin(play.tx, play.seasonId, ctx.input.spin, timing)
        const round = await roundOnSpin(play, spin)
        const spot = spotById(ctx.input.spot)
        const bet = round?.detail.bets.find((b) => b.spot === spot.id)
        if (!round || !bet) throw badRequest(`You have no chips on ${spot.name}.`, 'no_bet')

        const on = BigInt(bet.amount)
        const amount = ctx.input.amount === undefined ? on : BigInt(ctx.input.amount)
        const off = amount < on ? amount : on
        if (off < on && on - off < play.config.min_bet) {
          throw badRequest(
            `Leave at least ${formatChips(play.config.min_bet)} on ${spot.name}, or take it all off.`,
            'bad_bet',
          )
        }
        const bets = removeBet(round.detail.bets, spot.id, off)
        return play.result(await lowerBets(play, round, bets, off))
      }),
  }),

  route({
    method: 'POST',
    path: '/api/roulette/clear',
    auth: 'user',
    idempotent: true,
    input: RouletteClearInput,
    run: (ctx) =>
      playTransaction(ctx, roulette, async (play) => {
        const timing = timingFromConfig(play.config)
        const spin = await lockOpenSpin(play.tx, play.seasonId, ctx.input.spin, timing)
        const round = await roundOnSpin(play, spin)
        if (!round) throw badRequest('You have no bets on this spin.', 'no_bet')
        return play.result(await lowerBets(play, round, [], round.stake))
      }),
  }),

  route({
    method: 'POST',
    path: '/api/roulette/settle',
    auth: 'user',
    // Settling pays everyone at the table, so it is keyed like any chip
    // move; the spin's row makes a second settle a plain read anyway.
    idempotent: true,
    input: RouletteSettleInput,
    run: async (ctx) => {
      const season = await currentSeason()
      if (!season) throw new ApiError(409, 'no_season', 'There is no season yet.')
      return chipTransaction(ctx, async (tx, afterCommit): Promise<SettleResponse> => {
        const rt = await roundTx(tx, afterCommit)
        const outcome = await settleSpinIn(rt, season.id, ctx.input.spin)
        if (outcome.state === 'drawn') {
          return { state: 'drawn', result: outcome.result, window: outcome.window }
        }
        if (outcome.state === 'open') return outcome
        // Nothing saved: nobody bet, unless betting is still open.
        const window = await spinTimes(tx, season.id, ctx.input.spin, timingFromConfig(rt.config))
        const now = (await dbNow(tx)).getTime()
        if (window && now < window.closesAt) {
          return { state: 'open', spin: ctx.input.spin, closesAt: window.closesAt }
        }
        return { state: 'empty', spin: ctx.input.spin }
      })
    },
  }),
]

export const rouletteApi = createApi(rouletteRoutes)
