/**
 * Betting from the stream (spec: Games > Roulette): the .roulette command
 * comes here. The server adds the bets to the open round, or opens a round
 * with them; either way the round's one card goes in your stream at once,
 * pinned above the box until it has landed.
 *
 * Your wallet follows the bet, but waits while a spin you are on is still
 * landing: a bet that opens the next round settles the last one first, so
 * its wallet already counts that spin's result.
 */
import type { QueryClient } from '@tanstack/react-query'

import type { RouletteBetResult } from '../../../shared/games/roulette.ts'
import { api, requestKey } from '../../kit/api.ts'
import { putSharedRound, showCard } from '../../kit/cards.ts'
import { applyWallet } from '../../kit/queries.ts'
import { afterReveal } from '../../kit/reveal.ts'
import type { BetToPlace } from './typed.ts'

/** Places bets on the open round, or opens one. Throws the server's refusal. */
export async function placeBets(
  queryClient: QueryClient,
  me: string,
  bets: readonly BetToPlace[],
): Promise<RouletteBetResult> {
  const result = await api.post<RouletteBetResult>(
    '/api/roulette/bet',
    { bets: bets.map((b) => ({ spot: b.spot, bet: b.amount })) },
    { key: requestKey() },
  )
  putSharedRound(result.table)
  showCard(result.card)
  afterReveal(me, () => applyWallet(queryClient, result.wallet))
  return result
}
