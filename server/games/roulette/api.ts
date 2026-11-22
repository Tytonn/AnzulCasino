/**
 * Roulette's endpoints, served by netlify/functions/roulette-api.ts:
 *
 *   POST /api/roulette/bet      { bets: [{ spot, bet }] } -> the round, the wallet, the spin and its card
 *   POST /api/roulette/settle   { table } -> draws a closed spin, or reads its number
 *
 * There is one round on the wheel at a time (spec: Games > Roulette). The
 * first bet opens it, with one card in the stream for everyone, and every
 * bet while it is open joins it and starts its countdown again. A player's
 * bets on one spin are one game round: the first bet starts it and the rest
 * raise it. Chips leave the wallet the moment a bet goes down, and a bet is
 * never taken back. Bettors' browsers call settle at the close; the first
 * request draws the number and pays everyone, the rest read it. Every
 * request also settles any closed spin left behind, so nothing waits on a
 * timer (the daily sweep is only a backup).
 */
import type { ChatMessage } from '../../../shared/chat.ts'
import {
  addBets,
  RouletteBetInput,
  type RouletteDetail,
  type RouletteResult,
  RouletteSettleInput,
} from '../../../shared/games/roulette.ts'
import { badRequest, conflict, notFound } from '../../lib/errors.ts'
import { createApi, route } from '../../lib/http.ts'
import { chipTransaction } from '../../lib/idempotency.ts'
import {
  type Play,
  type PlayOut,
  playTransaction,
  type Round,
  type RoundOut,
  roundTx,
} from '../../lib/rounds.ts'
import { currentSeason, requireBetsOpen } from '../../lib/seasons.ts'
import {
  postSharedCard,
  sharedCardOf,
  sharedRoundEvent,
  type SharedRoundOut,
  sharedRoundView,
} from '../../lib/shared-rounds.ts'
import { lockWallet } from '../../lib/wallet.ts'
import { resolveBets } from './rules.ts'
import { joinOrOpenSpin, roulette, settleDueSpins, settleSpinIn, type SpinRow } from './spins.ts'

export { roulette }

/** A quick run of typed bets: twice the usual per-minute limit. */
const BET_LIMIT = { limit: 240, windowSeconds: 60 }

type Table = SharedRoundOut<RouletteDetail, RouletteResult>

/** POST /api/roulette/bet, before its chips become numbers (RouletteBetResult). */
interface BetOut {
  round: RoundOut<RouletteDetail>
  wallet: PlayOut['wallet']
  table: Table
  card: Omit<ChatMessage, 'sharedRound'> & { sharedRound: Table }
}

function staleRound() {
  return conflict('The last spin is still being paid out. Try again in a moment.', 'spin_settling')
}

/** Settles closed spins left behind, before a request that changes the table. */
async function catchUp(waitUntil: (promise: Promise<unknown>) => void): Promise<void> {
  const season = await currentSeason()
  if (season) await settleDueSpins(waitUntil, season.id)
}

/** The player's open round on this spin, locked, or null. Refuses one left on another spin. */
async function roundOnSpin(play: Play, spin: SpinRow): Promise<Round<RouletteDetail> | null> {
  const open = await play.current<RouletteDetail>()
  if (open && open.sharedRoundId !== spin.id) throw staleRound()
  return open
}

/** "Roulette · Round 12": the card's line in the classic places that list it as text. */
function cardBody(spin: SpinRow): string {
  return `${roulette.name} · Round ${spin.roundNo}`
}

export const rouletteRoutes = [
  route({
    method: 'POST',
    path: '/api/roulette/bet',
    auth: 'user',
    idempotent: true,
    input: RouletteBetInput,
    limit: BET_LIMIT,
    run: async (ctx) => {
      await catchUp(ctx.waitUntil)
      return playTransaction(ctx, roulette, async (play): Promise<BetOut> => {
        await requireBetsOpen(play.tx, play.seasonId)
        const { spin, opened } = await joinOrOpenSpin(play.rt, play.seasonId)
        const open = await roundOnSpin(play, spin)

        // Each bet is checked against what is left as the ones before it go down.
        const wallet = await lockWallet(play.tx, play.seasonId, play.userId)
        const limits = { minBet: play.config.min_bet, maxBetPct: play.config.max_bet_pct }
        const resolved = resolveBets(ctx.input.bets, wallet.balance, limits)
        if (!resolved.ok) throw badRequest(resolved.error, 'bad_bet')

        let round: Round<RouletteDetail>
        if (open) {
          const detail = { ...open.detail, bets: addBets(open.detail.bets, resolved.bets) }
          round = await play.raise(open, { amount: resolved.total, detail })
        } else {
          // The first bet opens the round; any others in the request raise it,
          // so each passes the bet limits on its own, as it did above.
          const [first, ...rest] = resolved.bets
          if (!first) throw badRequest('Place at least one bet.', 'bad_bet')
          const detail: RouletteDetail = { spin: spin.roundNo, bets: [], number: null, wins: [] }
          round = await play.start<RouletteDetail>({
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
        }

        // The spin as it stands, with this bet on it: a new spin's card
        // carries it, and an open one's card hears it as shared.updated.
        const table = await sharedRoundView<RouletteDetail, RouletteResult>(play.tx, spin.id)
        if (!table) throw new Error('The spin went missing')
        let card = opened ? null : await sharedCardOf(play.tx, spin.id)
        if (card) play.rt.emit(sharedRoundEvent(table))
        else card = await postSharedCard(play.rt, roulette, table, cardBody(spin))

        const result = await play.result(round)
        return {
          round: result.round,
          wallet: result.wallet,
          table,
          card: { ...card, sharedRound: table },
        }
      })
    },
  }),

  route({
    method: 'POST',
    path: '/api/roulette/settle',
    auth: 'user',
    // Settling pays everyone at the table, so it is keyed like any chip
    // move; the spin's row makes a second settle a plain read anyway.
    idempotent: true,
    input: RouletteSettleInput,
    run: (ctx) =>
      chipTransaction(ctx, async (tx, afterCommit) => {
        const rt = await roundTx(tx, afterCommit)
        const outcome = await settleSpinIn(rt, ctx.input.table)
        const table =
          outcome.state === 'none'
            ? null
            : await sharedRoundView<RouletteDetail, RouletteResult>(tx, ctx.input.table)
        if (outcome.state === 'none' || !table) {
          throw notFound('There is no roulette round like that.')
        }
        return { state: outcome.state, table }
      }),
  }),
]

export const rouletteApi = createApi(rouletteRoutes)
