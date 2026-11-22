/**
 * Flipping from the stream (spec: The stream > Cards): the .flip command and
 * a card's Flip again both come here. The flip's card goes in the stream at
 * once, pinned above the box with the keys, and the news of its result (the
 * wallet, the leaderboard, a big-win post) waits until the coin has landed:
 * the hold is handed to the card, which lets go once the coin is down.
 */
import type { QueryClient } from '@tanstack/react-query'

import type { CoinflipDetail, Side } from '../../../shared/games/coinflip.ts'
import type { PlayResult } from '../../../shared/rounds.ts'
import { api, requestKey } from '../../kit/api.ts'
import { holdForCard, putRound, showCard } from '../../kit/cards.ts'
import { applyWallet } from '../../kit/queries.ts'
import { afterReveal, holdReveal } from '../../kit/reveal.ts'
import { applyRound } from '../../kit/room.ts'

/** The side you called last in this tab: a .flip with no side calls it again. */
let lastCall: Side = 'heads'

export function lastCalled(): Side {
  return lastCall
}

/** Flips at `bet`, as typed ("50", "half", "all", "2.5k"), calling `call`. Throws the server's refusal. */
export async function flipCoin(
  queryClient: QueryClient,
  me: string,
  bet: string,
  call: Side,
): Promise<PlayResult<CoinflipDetail>> {
  const release = holdReveal({ players: [me] })
  let handed = false
  try {
    const result = await api.post<PlayResult<CoinflipDetail>>(
      '/api/coinflip/play',
      { bet, call },
      { key: requestKey() },
    )
    lastCall = call
    putRound(result.round)
    if (result.card) {
      holdForCard(result.round.id, release)
      handed = true
      showCard(result.card)
    }
    afterReveal(me, () => {
      applyRound(queryClient, result.round)
      applyWallet(queryClient, result.wallet)
    })
    return result
  } finally {
    if (!handed) release(0)
  }
}
