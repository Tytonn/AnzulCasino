/**
 * A round's draw as this tab sees it (spec: Games > Roulette): the close, the
 * settle, the result popping up, and every bettor's news held until it does.
 * It runs from the server's clock and the round's newest view (the shared
 * round store), with no stream of events of its own. It lives outside the
 * card, so a round carries on while its card moves from above the message
 * box back into the stream.
 *
 * - From just before the close until the result shows, news of every bettor
 *   waits (src/kit/reveal.ts): no wallet, leaderboard, ticker line or chat
 *   post gives the number away. A bet that moves the close lets it go again.
 * - At the close, bettors' browsers ask the server to settle: the first
 *   request draws the number and pays everyone, the rest read it. Other
 *   screens hear it as shared.updated, and ask themselves only if it has not
 *   come a moment later.
 * - The result shows as soon as the number is in. Your own result plays its
 *   sound or celebration once.
 */
import { useEffect, useRef, useState } from 'react'

import {
  type RouletteTable,
  type SettleResponse,
  tableNumber,
} from '../../../shared/games/roulette.ts'
import { markSharedShown, putSharedRound, useSharedRounds } from '../../kit/cards.ts'
import {
  api,
  celebrate,
  holdReveal,
  isBigWin,
  playSound,
  requestKey,
  serverNow,
} from '../../kit/index.ts'
import { playDrop } from './sounds.ts'

/** The hold on bettors' news starts this long before the close. */
const HOLD_LEAD_MS = 1_200
/** Screens without a bet settle only if no number has come this long after the close. */
const FALLBACK_MS = 1_600
/** Bettors' settle requests spread over this much, so one draws and the rest read. */
const JITTER_MS = 150
/** A round this tab first sees drawn this long after its close shows its result quietly. */
const QUIET_AFTER_MS = 5_000
/** How often a draw looks at the clock. */
const STEP_MS = 100
/** A hold lets go by itself after 15 seconds (src/kit/reveal.ts), so one this old is taken again. */
const RENEW_MS = 10_000
/** Draws remembered: only the latest few are ever on show. */
const KEEP = 24

interface Draw {
  id: number
  /** Each held bettor's release, and when it was taken. */
  held: Map<string, { free: (forMs: number) => void; at: number }>
  /** The close this tab has asked the server to settle at, and the one it fell back on. */
  settlingFor: number | null
  fallbackFor: number | null
  /** The result is on show. */
  shown: boolean
  /** Already drawn a while ago when this tab first saw it: no sound or celebration. */
  quiet: boolean
}

export interface DrawOptions {
  me: string
  bigWinTimes: number
}

const draws = new Map<number, Draw>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function current(id: number): RouletteTable | undefined {
  return useSharedRounds.getState().rounds[id] as RouletteTable | undefined
}

function drawFor(table: RouletteTable): Draw {
  const known = draws.get(table.id)
  if (known) return known
  const quiet =
    tableNumber(table) !== null && serverNow() >= Date.parse(table.closesAt) + QUIET_AFTER_MS
  const draw: Draw = {
    id: table.id,
    held: new Map(),
    settlingFor: null,
    fallbackFor: null,
    shown: false,
    quiet,
  }
  draws.set(table.id, draw)
  for (const id of [...draws.keys()].sort((a, b) => a - b).slice(0, -KEEP)) {
    const old = draws.get(id)
    if (old) release(old)
    draws.delete(id)
  }
  return draw
}

function hold(draw: Draw, players: readonly string[]) {
  const fresh = players.filter((p) => !draw.held.has(p))
  if (fresh.length === 0) return
  const free = holdReveal({ players: fresh })
  const at = Date.now()
  for (const p of fresh) draw.held.set(p, { free, at })
}

/** Takes old holds again before they let go by themselves: the new one first, so nothing slips out. */
function renew(draw: Draw) {
  const now = Date.now()
  const stale = [...draw.held].filter(([, h]) => now - h.at > RENEW_MS)
  if (stale.length === 0) return
  const free = holdReveal({ players: stale.map(([p]) => p) })
  for (const [p, h] of stale) {
    draw.held.set(p, { free, at: now })
    h.free(0)
  }
}

function release(draw: Draw) {
  for (const { free } of draw.held.values()) free(0)
  draw.held.clear()
}

/** Asks the server to settle the round at `closes`, until it is drawn or a later bet moves the close. */
async function settle(draw: Draw, closes: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const table = current(draw.id)
    if (!table || tableNumber(table) !== null || Date.parse(table.closesAt) !== closes) return
    try {
      const res = await api.post<SettleResponse>(
        '/api/roulette/settle',
        { table: draw.id },
        { key: requestKey() },
      )
      putSharedRound(res.table)
      if (res.state === 'drawn') return
      // Still open by the database's clock. A later close is the next step's
      // to ask for; the same one, a moment early on this clock, is asked again.
      const close = Date.parse(res.table.closesAt)
      if (close !== closes) return
      await sleep(Math.max(150, close - serverNow() + 120))
    } catch {
      await sleep(400 * (attempt + 1))
    }
  }
}

/** The number is in: the result shows, the news goes, and your result plays out. */
function show(draw: Draw, table: RouletteTable, options: DrawOptions) {
  draw.shown = true
  release(draw)
  markSharedShown(draw.id)
  if (draw.quiet) return
  const mine = table.rounds.find((r) => r.userId === options.me)
  if (!mine) return
  playDrop(0)
  const net = (mine.payout ?? 0) - mine.stake
  if (net > 0) {
    celebrate({
      net,
      big: isBigWin(mine, options.bigWinTimes),
      note: mine.allIn ? 'All in' : undefined,
    })
  } else if (net < 0) {
    playSound('loss')
  } else {
    playSound('chip')
  }
}

/** One look at the clock: the holds, the settle, and the result once the number is in. */
function step(draw: Draw, options: DrawOptions) {
  const table = current(draw.id)
  if (!table || draw.shown) return
  if (tableNumber(table) !== null) {
    show(draw, table, options)
    return
  }
  const now = serverNow()
  const closes = Date.parse(table.closesAt)
  const bettors = [...new Set(table.rounds.map((r) => r.userId))]

  // Every bettor's news waits from just before the close until the result shows.
  if (now < closes - HOLD_LEAD_MS) release(draw)
  else {
    hold(draw, bettors)
    renew(draw)
  }
  if (now < closes) return

  if (bettors.includes(options.me)) {
    if (draw.settlingFor !== closes) {
      draw.settlingFor = closes
      void sleep(Math.floor(Math.random() * JITTER_MS)).then(() => settle(draw, closes))
    }
  } else if (draw.fallbackFor !== closes && now >= closes + FALLBACK_MS) {
    draw.fallbackFor = closes
    void settle(draw, closes)
  }
}

/** Follows a round's draw in this tab while its card is on show: true once its result shows. */
export function useDraw(table: RouletteTable, options: DrawOptions): boolean {
  const draw = drawFor(table)
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  const [shown, setShown] = useState(draw.shown)

  // The draw reads the round from the store, and a card from the stream's
  // page, or fetched again after a gap, may be newer than what is there.
  useEffect(() => {
    putSharedRound(table)
  }, [table])

  useEffect(() => {
    if (draw.shown) {
      // Shown while its card was away: it shows again as it was.
      markSharedShown(draw.id)
      return
    }
    const tick = () => {
      step(draw, latest.current)
      if (!draw.shown) return
      setShown(true)
      clearInterval(timer)
    }
    const timer = setInterval(tick, STEP_MS)
    tick()
    return () => clearInterval(timer)
  }, [draw])

  return shown || draw.shown
}
