/**
 * A spin as this tab plays it (spec: Games > Roulette): the close, the ball,
 * the landing, and every bettor's news held until the ball lands. It runs
 * from the server's clock and the spin's newest view (the shared round
 * store), so every screen shows the same spin without a stream of events.
 * It lives outside the card, so a spin carries on while its card moves from
 * above the message box back into the stream.
 *
 * - From just before the close until the ball lands, news of every bettor
 *   waits (src/kit/reveal.ts): no wallet, leaderboard, ticker line or chat
 *   post gives the number away. A bet that moves the close lets it go again.
 * - At the close the ball launches on every screen. Bettors' browsers ask
 *   the server to settle: the first request draws the number and pays
 *   everyone, the rest read it. Other screens hear it as shared.updated, and
 *   ask themselves only if it has not come a moment later.
 * - A bet that lands just before the close moves it: the ball goes back to
 *   its pocket and the countdown starts again.
 * - Once the ball rests, the card shows the result and says so; your own
 *   result plays its sound or celebration once.
 */
import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'

import {
  type RouletteTable,
  type SettleResponse,
  spinMsOf,
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
import { bounceTimes, landingTime, MIN_LAND_MS, type SpinPlan } from './ball.ts'
import { playBounce, playDrop, playLaunch } from './sounds.ts'

/** The hold on bettors' news starts this long before the close. */
const HOLD_LEAD_MS = 1_200
/** Screens without a bet settle only if no number has come this long after the close. */
const FALLBACK_MS = 1_600
/** Bettors' settle requests spread over this much, so one draws and the rest read. */
const JITTER_MS = 150
/** A number that comes this long after the planned landing shows at once, without a spin. */
const LATE_LIMIT_MS = 2_500
/** How often a spin looks at the clock. */
const STEP_MS = 100
/** A hold lets go by itself after 15 seconds (src/kit/reveal.ts), so one this old is taken again. */
const RENEW_MS = 10_000
/** Spins remembered: only the latest few are ever on show. */
const KEEP = 24

interface Spin {
  id: number
  /** The ball, read by the wheel every frame. */
  plan: SpinPlan | null
  /** Each held bettor's release, and when it was taken. */
  held: Map<string, { free: (forMs: number) => void; at: number }>
  /** The close this tab has asked the server to settle at, and the one it fell back on. */
  settlingFor: number | null
  fallbackFor: number | null
  /** The close whose launch has played, and the landing whose bounces are booked. */
  launchedFor: number | null
  soundsFor: number | null
  landed: boolean
  /** Already over when this tab first saw it: it shows as it landed, with no sounds. */
  still: boolean
}

export interface SpinOptions {
  me: string
  reduced: boolean
  bigWinTimes: number
}

const spins = new Map<number, Spin>()
/** The pocket the ball rests in between spins: the last number this tab saw land. */
let resting: number | null = null

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function current(id: number): RouletteTable | undefined {
  return useSharedRounds.getState().rounds[id] as RouletteTable | undefined
}

function landsAtOf(table: RouletteTable): number {
  return Date.parse(table.closesAt) + spinMsOf(table)
}

function spinFor(table: RouletteTable): Spin {
  const known = spins.get(table.id)
  if (known) return known
  const number = tableNumber(table)
  const still = number !== null && serverNow() >= landsAtOf(table) + LATE_LIMIT_MS
  const spin: Spin = {
    id: table.id,
    plan: still ? landedPlan(table, number) : null,
    held: new Map(),
    settlingFor: null,
    fallbackFor: null,
    launchedFor: null,
    soundsFor: null,
    landed: still,
    still,
  }
  spins.set(table.id, spin)
  for (const id of [...spins.keys()].sort((a, b) => a - b).slice(0, -KEEP)) {
    const old = spins.get(id)
    if (old) release(old)
    spins.delete(id)
  }
  return spin
}

function landedPlan(table: RouletteTable, number: number): SpinPlan {
  const closes = Date.parse(table.closesAt)
  return {
    spin: table.id,
    launchAt: closes,
    landsAt: closes,
    landAt: closes,
    number,
    knownAt: closes,
    from: null,
  }
}

function hold(spin: Spin, players: readonly string[]) {
  const fresh = players.filter((p) => !spin.held.has(p))
  if (fresh.length === 0) return
  const free = holdReveal({ players: fresh })
  const at = Date.now()
  for (const p of fresh) spin.held.set(p, { free, at })
}

/** Takes old holds again before they let go by themselves: the new one first, so nothing slips out. */
function renew(spin: Spin) {
  const now = Date.now()
  const stale = [...spin.held].filter(([, h]) => now - h.at > RENEW_MS)
  if (stale.length === 0) return
  const free = holdReveal({ players: stale.map(([p]) => p) })
  for (const [p, h] of stale) {
    spin.held.set(p, { free, at: now })
    h.free(0)
  }
}

function release(spin: Spin) {
  for (const { free } of spin.held.values()) free(0)
  spin.held.clear()
}

/** Asks the server to settle the spin at `closes`, until it is drawn or a later bet moves the close. */
async function settle(spin: Spin, closes: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const table = current(spin.id)
    if (!table || tableNumber(table) !== null || Date.parse(table.closesAt) !== closes) return
    try {
      const res = await api.post<SettleResponse>(
        '/api/roulette/settle',
        { table: spin.id },
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

/** The ball has come to rest: the result shows, the news goes, and your result plays out. */
function land(spin: Spin, table: RouletteTable, number: number, options: SpinOptions) {
  spin.landed = true
  resting = number
  release(spin)
  markSharedShown(spin.id)
  if (spin.still) return
  const mine = table.rounds.find((r) => r.userId === options.me)
  if (!mine) return
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

/** One look at the clock: holds, the launch, the settle, the landing. */
function step(spin: Spin, options: SpinOptions) {
  const table = current(spin.id)
  if (!table || spin.landed) return
  const now = serverNow()
  const closes = Date.parse(table.closesAt)
  const spinMs = spinMsOf(table)
  const landsAt = closes + spinMs
  const number = tableNumber(table)
  const bettors = [...new Set(table.rounds.map((r) => r.userId))]
  const mine = bettors.includes(options.me)

  // Every bettor's news waits from just before the close until the ball lands.
  if (number === null && now < closes - HOLD_LEAD_MS) release(spin)
  else {
    hold(spin, bettors)
    renew(spin)
  }

  if (number === null) {
    // Rests in its pocket until the close, then rolls; a moved close puts it back.
    if (spin.plan?.launchAt !== closes || spin.plan.number !== null) {
      spin.plan = {
        spin: spin.id,
        launchAt: closes,
        landsAt,
        landAt: landsAt,
        number: null,
        knownAt: null,
        from: resting,
      }
    }
    if (now >= closes && spin.launchedFor !== closes) {
      spin.launchedFor = closes
      if (mine && !options.reduced && now - closes < 600) playLaunch(spinMs - 1_600)
    }
    if (now >= closes) {
      if (mine && spin.settlingFor !== closes) {
        spin.settlingFor = closes
        void sleep(Math.floor(Math.random() * JITTER_MS)).then(() => settle(spin, closes))
      } else if (
        !mine &&
        spin.fallbackFor !== closes &&
        spin.settlingFor !== closes &&
        now >= closes + FALLBACK_MS
      ) {
        spin.fallbackFor = closes
        void settle(spin, closes)
      }
    }
    return
  }

  // The number is in: the ball bends onto it and lands.
  if (spin.plan?.number !== number) {
    const late = now >= landsAt + LATE_LIMIT_MS
    const minimum = options.reduced ? 300 : MIN_LAND_MS
    spin.plan = {
      spin: spin.id,
      launchAt: closes,
      landsAt,
      landAt: late ? now : landingTime(landsAt, now, minimum),
      number,
      knownAt: now,
      from: spin.plan?.from ?? resting,
    }
  }
  const plan = spin.plan
  if (mine && !options.reduced && spin.soundsFor !== plan.landAt && plan.landAt > now) {
    spin.soundsFor = plan.landAt
    for (const at of bounceTimes(plan)) if (at > now) playBounce(at - now)
    playDrop(plan.landAt - now)
  }
  if (now >= plan.landAt) land(spin, table, number, options)
}

export interface SpinState {
  /** The ball, for the wheel. */
  plan: RefObject<SpinPlan | null>
  /** True once the ball rests: the card shows the result. */
  landed: boolean
}

/** Plays a spin in this tab while its card is on show. */
export function useSpin(table: RouletteTable, options: SpinOptions): SpinState {
  const spin = spinFor(table)
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })
  const [landed, setLanded] = useState(spin.landed)

  useEffect(() => {
    if (spin.landed) {
      // Over before this tab saw it, or landed while its card was away: it shows as it landed.
      markSharedShown(spin.id)
      return
    }
    const tick = () => {
      step(spin, latest.current)
      if (spin.landed) setLanded(true)
    }
    tick()
    const timer = setInterval(tick, STEP_MS)
    return () => clearInterval(timer)
  }, [spin])

  // The wheel reads the ball from the spin itself, so it never misses a frame.
  const plan = useMemo<RefObject<SpinPlan | null>>(
    () => ({
      get current() {
        return spin.plan
      },
    }),
    [spin],
  )
  return { plan, landed: landed || spin.landed }
}
