/**
 * Coin flip's endpoints, served by netlify/functions/coinflip-api.ts. The
 * reference for every game lane (docs/LANE_GUIDE.md walks through it):
 *
 *   GET  /api/coinflip/room   each seated player's latest round
 *   POST /api/coinflip/play   { bet, call } -> the settled round and the wallet
 *
 * One request bets and flips. Inside one transaction, the round helper takes
 * the stake, the coin is drawn at that moment (rule 7, draw late), and the
 * round settles and pays. The room, the ticker, the leaderboard and any chat
 * post hear about it after the commit. A repeated idempotency key returns
 * the first answer and changes nothing.
 */
import {
  COINFLIP,
  type CoinflipDetail,
  CoinflipPlayInput,
  coinflipPayout,
  SIDE_NAMES,
} from '../../../shared/games/coinflip.ts'
import { createApi, route } from '../../lib/http.ts'
import { defineServerGame, playTransaction, roomState } from '../../lib/rounds.ts'
import { flip } from './rules.ts'

export const coinflip = defineServerGame({ id: COINFLIP, name: 'Coin flip' })

export const coinflipRoutes = [
  route({
    method: 'GET',
    path: '/api/coinflip/room',
    auth: 'user',
    // Rounds never stay open here, so there are no idle rounds to finish.
    run: () => roomState(coinflip),
  }),
  route({
    method: 'POST',
    path: '/api/coinflip/play',
    auth: 'user',
    idempotent: true,
    input: CoinflipPlayInput,
    run: (ctx) =>
      playTransaction(ctx, coinflip, async (play) => {
        const { bet, call } = ctx.input
        // The edge is read once and saved with the round, so its replay and
        // its payout agree even if the admin changes it mid-flip.
        const edgePct = play.config.coinflip_edge_pct
        const round = await play.start<CoinflipDetail>({
          bet,
          detail: { call, face: null, edgePct },
        })
        const face = flip()
        const settled = await play.settle(round, {
          payout: coinflipPayout(round.stake, face === call, edgePct),
          detail: { call, face, edgePct },
          summary: SIDE_NAMES[face],
        })
        return play.result(settled)
      }),
  }),
]

export const coinflipApi = createApi(coinflipRoutes)
