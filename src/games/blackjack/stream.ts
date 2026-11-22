/**
 * Dealing from the stream (spec: The stream > Cards): the .bj command and a
 * card's Deal again both come here. The hand's card goes in the stream at
 * once, pinned above the box with the keys, and the news of its result (the
 * wallet, the leaderboard, a big-win post) waits until the card has dealt
 * it: the hold is handed to the card, which lets go once the cards are down.
 */
import type { QueryClient } from '@tanstack/react-query'

import type { BlackjackDetail } from '../../../shared/games/blackjack.ts'
import type { PlayResult } from '../../../shared/rounds.ts'
import { api, requestKey } from '../../kit/api.ts'
import { holdForCard, putRound, showCard } from '../../kit/cards.ts'
import { applyWallet } from '../../kit/queries.ts'
import { afterReveal, holdReveal } from '../../kit/reveal.ts'
import { applyRound } from '../../kit/room.ts'

/** Deals a hand at `bet`, as typed: "50", "half", "all", "2.5k". Throws the server's refusal. */
export async function dealHand(queryClient: QueryClient, me: string, bet: string): Promise<void> {
  const release = holdReveal({ players: [me] })
  let handed = false
  try {
    const result = await api.post<PlayResult<BlackjackDetail>>(
      '/api/blackjack/deal',
      { bet },
      { key: requestKey() },
    )
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
  } finally {
    if (!handed) release(0)
  }
}
