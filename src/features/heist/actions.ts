/**
 * What a player buys or moves, as hooks with a busy flag: a shield charge,
 * the extra steal attempt and a vault move. Each request carries its own
 * Idempotency-Key, and the answer moves the top bar and the heist state at
 * once, with a sound and a plain-word toast.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { chipCount } from '../../../shared/chips.ts'
import type {
  ExtraAttemptResponse,
  ShieldResponse,
  VaultDirection,
  VaultResponse,
} from '../../../shared/features/heist.ts'
import { api, errorMessage, requestKey } from '../../kit/api.ts'
import { applyWallet } from '../../kit/queries.ts'
import { playSound } from '../../kit/sfx.ts'
import { toast } from '../../kit/toast.tsx'
import { heistKeys, patchHeist } from './data.ts'

/** A request that runs once at a time and reports through a toast. */
function useAction<T>(send: () => Promise<T>, done: (answer: T) => void) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  async function run(): Promise<T | null> {
    if (running.current) return null
    running.current = true
    setBusy(true)
    try {
      const answer = await send()
      done(answer)
      return answer
    } catch (error) {
      playSound('thud')
      toast.error(errorMessage(error))
      // What we showed was out of date: fetch the truth.
      void queryClient.invalidateQueries({ queryKey: heistKeys.state })
      return null
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  return { run, busy }
}

export function useBuyShield() {
  const queryClient = useQueryClient()
  return useAction(
    () => api.post<ShieldResponse>('/api/heist/shield', {}, { key: requestKey() }),
    (answer) => {
      applyWallet(queryClient, answer.wallet)
      patchHeist(queryClient, (s) => ({
        ...s,
        me: { ...s.me, charges: answer.charges, shieldsThisWeek: answer.shieldsThisWeek },
      }))
      playSound('block')
      toast.good(
        answer.charges > 1
          ? `Shield up: ${answer.charges} charges. Each one blocks a steal.`
          : 'Shield up. The next steal is blocked.',
      )
    },
  )
}

export function useBuyExtraAttempt() {
  const queryClient = useQueryClient()
  return useAction(
    () => api.post<ExtraAttemptResponse>('/api/heist/extra-attempt', {}, { key: requestKey() }),
    (answer) => {
      applyWallet(queryClient, answer.wallet)
      patchHeist(queryClient, (s) => ({
        ...s,
        me: { ...s.me, extraBought: true, attemptsAllowed: answer.attemptsAllowed },
      }))
      playSound('sparkle')
      toast.good('One more steal attempt today. Pick your target.')
    },
  )
}

export function useVaultMove() {
  const queryClient = useQueryClient()
  const [last, setLast] = useState<VaultResponse | null>(null)
  const pending = useRef<{ direction: VaultDirection; amount: string } | null>(null)
  const action = useAction(
    () => {
      const move = pending.current
      if (!move) throw new Error('No vault move to send.')
      return api.post<VaultResponse>('/api/heist/vault', move, { key: requestKey() })
    },
    (answer) => {
      applyWallet(queryClient, answer.wallet)
      patchHeist(queryClient, (s) => ({ ...s, me: { ...s.me, vaultMoved: true } }))
      setLast(answer)
      playSound('chip')
      setTimeout(() => playSound('block'), 260)
      toast.good(
        answer.direction === 'deposit'
          ? `${chipCount(answer.amount)} locked in your vault, safe from steals.`
          : `${chipCount(answer.amount)} back in your wallet, ready to bet.`,
      )
    },
  )
  return {
    busy: action.busy,
    last,
    move: (direction: VaultDirection, amount: string) => {
      pending.current = { direction, amount }
      return action.run()
    },
  }
}
