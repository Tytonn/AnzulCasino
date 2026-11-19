/**
 * Blackjack's endpoints, served by netlify/functions/blackjack-api.ts:
 *
 *   GET  /api/blackjack/room   each seated player's latest hand, after finishing idle ones
 *   POST /api/blackjack/deal   { bet } -> the dealt round and the wallet
 *   POST /api/blackjack/move   { move, roundId, steps } -> the round after the move, and the wallet
 *
 * A round is one hand, kept open across requests (docs/LANE_GUIDE.md,
 * Rounds with more than one move). The deal takes the stake and then draws
 * the cards; a blackjack on either side settles the round in the same
 * request. Each move locks the round, and a double or a split takes the
 * extra stake before its card is drawn. Every card is drawn from what is
 * left of six decks at the moment it shows; only a hole card the dealer
 * peeks at is drawn early, and it waits in the round's secret, which no
 * response or event ever carries.
 */
import {
  BLACKJACK,
  type BlackjackDetail,
  BlackjackDealInput,
  BlackjackMoveInput,
  type BlackjackSecret,
  extraStake,
  isSlowRevealBet,
  roundPayout,
  summarize,
  undealt,
  whyNot,
} from '../../../shared/games/blackjack.ts'
import { chipCount } from '../../../shared/chips.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import { ApiError, badRequest } from '../../lib/errors.ts'
import { createApi, route } from '../../lib/http.ts'
import {
  defineServerGame,
  finishIdleRounds,
  type Play,
  playTransaction,
  type Round,
  roomState,
} from '../../lib/rounds.ts'
import { requireBetsOpen } from '../../lib/seasons.ts'
import { lockWallet } from '../../lib/wallet.ts'
import { commit, deal, dealtCards, drawFor, isOver, Shoe, standAll, type Table } from './rules.ts'

export const blackjack = defineServerGame({ id: BLACKJACK, name: 'Blackjack' })

type BlackjackRound = Round<BlackjackDetail, BlackjackSecret>

/** The share of the wallet over which a bet gets the slow reveal (blackjack_slow_reveal_pct). */
function slowRevealPct(config: ConfigValues): number {
  const value = (config as Partial<Record<string, unknown>>).blackjack_slow_reveal_pct
  return typeof value === 'number' ? value : 5_000
}

/** The round as the engine works on it. The detail is a copy, so the round stays as it was read. */
function tableOf(round: BlackjackRound): Table {
  return { detail: structuredClone(round.detail), hole: round.secret?.hole ?? null }
}

/** Saves the table after a deal or a move: settles the round when the hand is over. */
async function save(play: Play, round: BlackjackRound, table: Table) {
  if (isOver(table)) {
    const settled = await play.settle(round, {
      payout: roundPayout(table.detail),
      detail: table.detail,
      summary: summarize(table.detail),
    })
    return play.result(settled)
  }
  const next = await play.act(round, {
    detail: table.detail,
    secret: table.hole ? { hole: table.hole } : null,
  })
  return play.result(next)
}

/**
 * Finishes a hand left idle past round_timeout_minutes by blackjack's
 * safest rule: every hand still in play stands, and the dealer plays it out.
 */
async function finishIdle(play: Play, round: BlackjackRound): Promise<void> {
  const table = tableOf(round)
  if (table.detail.hands.length === 0) {
    // The deal happens in the bet's own transaction, so this cannot be; hand the bet back if it is.
    await play.refund(round, { detail: table.detail, summary: 'Refunded: never dealt' })
    return
  }
  standAll(table, new Shoe(dealtCards(table)))
  await play.settle(round, {
    payout: roundPayout(table.detail),
    detail: table.detail,
    summary: summarize(table.detail),
  })
}

export const blackjackRoutes = [
  route({
    method: 'GET',
    path: '/api/blackjack/room',
    auth: 'user',
    run: async (ctx) => {
      await finishIdleRounds<BlackjackDetail, BlackjackSecret>(blackjack, ctx.waitUntil, finishIdle)
      return roomState(blackjack)
    },
  }),
  route({
    method: 'POST',
    path: '/api/blackjack/deal',
    auth: 'user',
    idempotent: true,
    input: BlackjackDealInput,
    run: (ctx) =>
      playTransaction(ctx, blackjack, async (play) => {
        const round = await play.start<BlackjackDetail, BlackjackSecret>({
          bet: ctx.input.bet,
          detail: undealt(),
        })
        // The wallet is already locked by the bet; this reads what is left beside the stake.
        const wallet = await lockWallet(play.tx, play.seasonId, play.userId)
        const slowReveal = isSlowRevealBet(
          round.stake,
          wallet.balance,
          round.allIn,
          slowRevealPct(play.config),
        )
        // Draw late: the cards come out of a fresh shoe after the stake is down.
        const table = deal(round.stake, new Shoe(), { slowReveal })
        return save(play, round, table)
      }),
  }),
  route({
    method: 'POST',
    path: '/api/blackjack/move',
    auth: 'user',
    idempotent: true,
    input: BlackjackMoveInput,
    run: (ctx) =>
      playTransaction(ctx, blackjack, async (play) => {
        const { move, roundId, steps } = ctx.input
        const round = await play.require<BlackjackDetail, BlackjackSecret>()
        if (round.id !== roundId || round.steps !== steps) {
          throw new ApiError(
            409,
            'stale_move',
            'Your hand moved on, maybe in another tab. Here it is now.',
          )
        }
        const table = tableOf(round)
        const problem = whyNot(table.detail, move)
        if (problem) throw badRequest(problem, 'bad_move')

        let current = round
        const extra = BigInt(extraStake(table.detail, move))
        if (extra > 0n) {
          // A double or a split is a new bet on the table: none after the season's end.
          await requireBetsOpen(play.tx, play.seasonId)
          const wallet = await lockWallet(play.tx, play.seasonId, play.userId)
          if (wallet.balance < extra) {
            const doing = move === 'double' ? 'Doubling' : 'Splitting'
            throw badRequest(
              `${doing} takes another ${chipCount(extra)}, and you have ${chipCount(wallet.balance)}.`,
              'insufficient_funds',
            )
          }
          commit(table, move)
          table.detail.slowReveal ||= isSlowRevealBet(
            round.stake + extra,
            wallet.balance - extra,
            wallet.balance === extra,
            slowRevealPct(play.config),
          )
          // The extra stake goes down before the card that answers it is drawn.
          current = await play.raise(round, {
            amount: extra,
            detail: structuredClone(table.detail),
          })
        } else {
          commit(table, move)
        }
        drawFor(table, move, new Shoe(dealtCards(table)))
        return save(play, current, table)
      }),
  }),
]

export const blackjackApi = createApi(blackjackRoutes)
