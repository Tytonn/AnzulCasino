/**
 * Sending a move in a game (spec: How a bet travels). One hook does the
 * parts every game needs: a fresh idempotency key per move, one move at a
 * time, the answer shown at once without waiting for the live echo, news of
 * the result held until the game has revealed it, and errors as toasts.
 *
 *   const play = usePlay<CoinflipDetail>()
 *   const result = await play.send('/api/coinflip/play', { bet, call }, { revealMs: 900 })
 *   if (result) startFlipAnimation(result.round)
 *
 * The answer is a `PlayResult`: the round as everyone sees it, and your
 * wallet after it. Animate from it. Everything else that would give the
 * result away waits for the reveal to end: your seat, the top bar, the
 * leaderboard, the ticker and the chat post. A move that leaves the round
 * open (a card dealt) shows on your seat at once.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { PlayResult } from '../../shared/rounds.ts'
import { api, ApiError, errorMessage, requestKey } from './api.ts'
import { applyWallet } from './queries.ts'
import { afterReveal, holdReveal } from './reveal.ts'
import { applyRound, roomKey } from './room.ts'
import { toast } from './toast.tsx'

export interface SendOptions {
  /** How long the game's reveal animation runs after the answer arrives. */
  revealMs?: number
}

export function usePlay<D = unknown>() {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)

  const send = useCallback(
    async (path: string, body: unknown, options: SendOptions = {}) => {
      // One move at a time: a double click places one bet.
      if (sending.current) return null
      sending.current = true
      setBusy(true)
      const release = holdReveal()
      try {
        const result = await api.post<PlayResult<D>>(path, body, { key: requestKey() })
        const settled = result.round.status !== 'open'
        if (!settled) applyRound(queryClient, result.round)
        release(options.revealMs ?? 0)
        afterReveal(() => {
          if (settled) applyRound(queryClient, result.round)
          applyWallet(queryClient, result.wallet)
        })
        return result
      } catch (error) {
        release(0)
        toast.error(errorMessage(error))
        // The round may have moved on in another tab: show the room as it is.
        if (error instanceof ApiError && error.status === 409) {
          const game = path.split('/')[2]
          if (game) void queryClient.invalidateQueries({ queryKey: roomKey(game) })
        }
        return null
      } finally {
        sending.current = false
        setBusy(false)
      }
    },
    [queryClient],
  )

  return { send, busy }
}
