/**
 * Keeping a result secret until the game shows it. The server answers a bet
 * at once, and its news (the wallet, the leaderboard, the ticker, a chat
 * post, a seat) can reach the page before the coin lands. A hold names the
 * players whose results are being revealed: news about them waits, then
 * plays out the moment the reveal ends. News about anyone else goes on. The
 * game kit's play hook holds your own results for you:
 *
 *   const release = holdReveal({ players: [me.id] })  // as the request goes out
 *   ...
 *   release(900)                                       // the animation needs 900ms more
 *
 * A table game that settles every bettor at once (roulette, crash, race)
 * holds them all from the close, before any result can arrive, until the
 * result shows:
 *
 *   const release = holdReveal({ players: bettors })
 *   ...
 *   release(0)                                         // the result is on show
 */

interface Hold {
  players: ReadonlySet<string>
  /** True until the hold is released. */
  pending: boolean
  /** Epoch ms when the animation ends. */
  until: number
}

interface Waiting {
  player: string
  task: () => void
}

/** The longest a hold lasts when nobody releases it. */
const MAX_HOLD_MS = 15_000

let holds: Hold[] = []
let waiting: Waiting[] = []
let timer: ReturnType<typeof setTimeout> | undefined

function isHeld(player: string, now: number): boolean {
  return holds.some((h) => h.players.has(player) && (h.pending || h.until > now))
}

/** Plays out the news whose holds have ended, and wakes when the next animation ends. */
function flush() {
  const now = Date.now()
  holds = holds.filter((h) => h.pending || h.until > now)
  const ready: Waiting[] = []
  const still: Waiting[] = []
  for (const w of waiting) (isHeld(w.player, now) ? still : ready).push(w)
  waiting = still
  clearTimeout(timer)
  timer = undefined
  const ends = holds.filter((h) => !h.pending).map((h) => h.until)
  if (waiting.length > 0 && ends.length > 0) {
    timer = setTimeout(flush, Math.min(...ends) - now)
  }
  for (const w of ready) w.task()
}

/**
 * Holds news about `players` until the returned function is called with how
 * long the animation still needs. Call it exactly once, also on failure
 * (with 0). A hold nobody releases lets go after 15 seconds.
 */
export function holdReveal({ players }: { players: readonly string[] }): (forMs: number) => void {
  const hold: Hold = { players: new Set(players), pending: true, until: 0 }
  holds.push(hold)
  let released = false
  const release = (forMs: number) => {
    if (released) return
    released = true
    clearTimeout(safety)
    hold.pending = false
    hold.until = Date.now() + Math.max(0, forMs)
    flush()
  }
  const safety = setTimeout(() => release(0), MAX_HOLD_MS)
  return release
}

/**
 * Runs `task`, a piece of news about `player`, now, or once every hold on
 * that player has ended. One player's news plays out in the order it came.
 */
export function afterReveal(player: string, task: () => void): void {
  // Anything whose hold has just ended goes first, so the order is kept.
  flush()
  if (!isHeld(player, Date.now()) && !waiting.some((w) => w.player === player)) {
    task()
    return
  }
  waiting.push({ player, task })
}
