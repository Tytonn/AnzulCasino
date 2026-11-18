/**
 * Keeping a result secret until the game shows it. The server answers a bet
 * at once, and its news (the wallet, the leaderboard, the ticker, a chat
 * post) can reach this tab before the coin lands. While a reveal is held,
 * news about this player's own chips and rounds waits, then plays out the
 * moment the reveal ends. The game kit's play hook holds it for you.
 *
 *   const release = holdReveal()        // as the request goes out
 *   ...
 *   release(900)                        // the animation needs 900ms more
 */
import { create } from 'zustand'

interface RevealState {
  /** Requests still waiting for their answer. */
  pending: number
  /** Epoch ms when the current animation ends. */
  until: number
}

const useReveal = create<RevealState>(() => ({ pending: 0, until: 0 }))

/** The longest a request can hold the news. */
const MAX_HOLD_MS = 15_000

let waiting: (() => void)[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function flush() {
  const { pending, until } = useReveal.getState()
  const left = until - Date.now()
  if (pending > 0) return
  if (left > 0) {
    clearTimeout(timer)
    timer = setTimeout(flush, left)
    return
  }
  const tasks = waiting
  waiting = []
  for (const task of tasks) task()
}

/**
 * Holds news until the returned function is called with how long the
 * animation still needs. Call that function exactly once, also on failure
 * (with 0).
 */
export function holdReveal(): (forMs: number) => void {
  useReveal.setState((s) => ({ pending: s.pending + 1 }))
  let released = false
  const release = (forMs: number) => {
    if (released) return
    released = true
    clearTimeout(safety)
    useReveal.setState((s) => ({
      pending: Math.max(0, s.pending - 1),
      until: Math.max(s.until, Date.now() + Math.max(0, forMs)),
    }))
    flush()
  }
  // A request that never answers must not hold the news forever.
  const safety = setTimeout(() => release(0), MAX_HOLD_MS)
  return release
}

/** Runs `task` now, or once the reveal in progress has finished. */
export function afterReveal(task: () => void): void {
  const { pending, until } = useReveal.getState()
  if (pending === 0 && until <= Date.now()) {
    task()
    return
  }
  waiting.push(task)
  flush()
}
