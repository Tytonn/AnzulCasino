/**
 * The wheel's clock and its spins in the browser (spec: Clock, The number,
 * Settlement). Everything runs from the server's clock: the spin taking bets
 * now, its close, the launch and the landing, so every screen agrees without
 * a stream of events.
 *
 * - At the close, a browser that has bets on the spin asks the server to
 *   settle it. The first request draws the number and pays everyone; the
 *   rest read it. Other screens hear the number as `round.result`, and ask
 *   themselves only if it has not come a moment later.
 * - From just before the close until the ball lands, the news of every
 *   bettor's result is held (src/kit/reveal.ts), so no seat, ticker line,
 *   leaderboard move or chat post gives the number away early.
 * - A spin nobody bet on does not spin (spec: Empty rounds).
 */
import { useQuery } from '@tanstack/react-query'
import { type RefObject, useEffect, useEffectEvent, useRef, useState } from 'react'

import { roomChannel } from '../../../shared/events.ts'
import {
  cycleMs,
  phaseAt,
  RECENT_RESULTS,
  ROULETTE,
  type RouletteClock,
  type RouletteDetail,
  type RouletteTable,
  type SettleResponse,
  type SpinPhase,
  type SpinResult,
  type SpinWindow,
  spinAt,
  spinWindow,
} from '../../../shared/games/roulette.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { api, holdReveal, requestKey, serverNow } from '../../kit/index.ts'
import { useLiveEvent, useResync } from '../../live/index.ts'
import { bounceTimes, landingTime, MIN_LAND_MS, type SpinPlan } from './ball.ts'
import { playBounce, playDrop, playLaunch } from './sounds.ts'

export const tableKey = ['roulette', 'table'] as const

/** The hold on bettors' news starts this long before the close. */
const HOLD_LEAD_MS = 1_200
/** Screens without bets settle only if no number has come this long after the close. */
const FALLBACK_MS = 1_600
/** Bettors' settle requests spread over this much, so one of them draws and the rest read. */
const JITTER_MS = 150
/** A spin whose number arrives later than this after its landing is shown without a spin. */
const LATE_LIMIT_MS = 2_500
/** How often the driver looks at the clock. */
const STEP_MS = 100
/**
 * A hold lets go by itself after 15 seconds (src/kit/reveal.ts), and a spin
 * can be set to run longer, so a hold this old is taken again.
 */
const RENEW_MS = 10_000

export type Stage = 'betting' | 'spinning' | 'landed' | 'empty'

interface SpinFlags {
  /** Each held player's hold, and when it was taken. */
  held: Map<string, { free: (ms: number) => void; at: number }>
  closed: boolean
  settling: boolean
  fallback: boolean
  empty: boolean
  plan: SpinPlan | null
  soundsAt: number | null
  landed: boolean
}

export interface Known {
  result: SpinResult
  /** Server ms when this screen learned it; 0 for results that were in the past already. */
  knownAt: number
}

export interface SpinsOptions {
  /** Every player's latest round in the room (the room's cache). */
  rounds: readonly RoundView<RouletteDetail>[]
  /** My user id. */
  me: string
  /** True while I have bets on `spin` that the server has taken. */
  mineOn: (spin: number) => boolean
  /** True while I have bets on `spin` still on their way. */
  pendingOn: (spin: number) => boolean
  reduced: boolean
  /** The ball has come to rest on `number`. */
  onLanded: (spin: number, number: number) => void
}

export interface Spins {
  clock: RouletteClock | null
  loading: boolean
  failed: boolean
  retry: () => void
  /** The spin running now, by the clock. */
  window: SpinWindow | null
  phase: SpinPhase | null
  /** The spin the table shows: the one taking bets, or one still spinning or showing its result. */
  shown: SpinWindow | null
  stage: Stage | null
  /** The shown spin's number, once the ball has landed. */
  number: number | null
  /** The ball, read by the wheel every frame. */
  plan: RefObject<SpinPlan | null>
  /** The latest numbers, newest first, only once they have landed on this screen. */
  recent: SpinResult[]
  /** Takes a clock the server sent with a refused bet. */
  adopt: (clock: RouletteClock) => void
}

function newFlags(): SpinFlags {
  return {
    held: new Map(),
    closed: false,
    settling: false,
    fallback: false,
    empty: false,
    plan: null,
    soundsAt: null,
    landed: false,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function bettorsOn(rounds: readonly RoundView<RouletteDetail>[], spin: number): string[] {
  return rounds
    .filter((r) => r.detail.spin === spin && r.status === 'open' && r.detail.bets.length > 0)
    .map((r) => r.userId)
}

export function useSpins(options: SpinsOptions): Spins {
  const table = useQuery({
    queryKey: tableKey,
    queryFn: () => api.get<RouletteTable>('/api/roulette/table'),
  })
  const { refetch } = table
  useResync(() => void refetch())

  const clockRef = useRef<RouletteClock | null>(null)
  const known = useRef(new Map<number, Known>())
  const flags = useRef(new Map<number, SpinFlags>())
  const plan = useRef<SpinPlan | null>(null)
  const landedRef = useRef<{ spin: number; number: number } | null>(null)
  const phaseKey = useRef('')
  const [, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  const latest = useRef(options)
  latest.current = options

  function flagsFor(spin: number): SpinFlags {
    let f = flags.current.get(spin)
    if (!f) {
      f = newFlags()
      flags.current.set(spin, f)
    }
    return f
  }

  function adopt(next: RouletteClock | null | undefined) {
    if (!next) return
    const current = clockRef.current
    if (!current || next.anchor.spin >= current.anchor.spin) {
      clockRef.current = next
      bump()
    }
  }

  /** The number before `spin`'s, where the ball rests when it is launched. */
  function restingNumber(before: number): number | null {
    let best: Known | null = null
    for (const k of known.current.values()) {
      if (k.result.spin < before && (!best || k.result.spin > best.result.spin)) best = k
    }
    return best?.result.number ?? null
  }

  function planFor(window: SpinWindow, launchAt: number): SpinPlan {
    return {
      spin: window.spin,
      launchAt,
      landsAt: window.landsAt,
      landAt: window.landsAt,
      number: null,
      knownAt: null,
      from: restingNumber(window.spin),
    }
  }

  /** A number has come in, from a settle, the room or the table. */
  function learn(result: SpinResult, past = false) {
    if (known.current.has(result.spin)) return
    const now = serverNow()
    known.current.set(result.spin, { result, knownAt: past ? 0 : now })
    const f = flagsFor(result.spin)
    f.empty = false
    const clock = clockRef.current
    const window = clock ? windowFor(clock, result.spin) : null
    if (window && !past && now < window.landsAt + LATE_LIMIT_MS) {
      const { reduced } = latest.current
      // Already rolling (bets were known at the close), or it starts now.
      f.plan ??= planFor(window, Math.max(window.closesAt, now))
      const min = reduced ? 300 : MIN_LAND_MS
      f.plan = {
        ...f.plan,
        number: result.number,
        knownAt: now,
        landAt: landingTime(window.landsAt, now, min),
      }
      if (plan.current?.spin === result.spin || !plan.current || plan.current.spin < result.spin) {
        plan.current = f.plan
      }
    } else {
      // Too late to spin it: it simply shows as landed.
      f.landed = true
      if (!landedRef.current || landedRef.current.spin < result.spin) {
        landedRef.current = { spin: result.spin, number: result.number }
      }
      release(f)
    }
    bump()
  }

  function release(f: SpinFlags) {
    for (const { free } of f.held.values()) free(0)
    f.held.clear()
  }

  function hold(f: SpinFlags, players: string[]) {
    const fresh = players.filter((p) => !f.held.has(p))
    if (fresh.length === 0) return
    const free = holdReveal({ players: fresh })
    const at = Date.now()
    for (const p of fresh) f.held.set(p, { free, at })
  }

  /** Takes old holds again before they let go by themselves: the new one first, so nothing slips out. */
  function renew(f: SpinFlags) {
    const now = Date.now()
    const stale = [...f.held].filter(([, h]) => now - h.at > RENEW_MS)
    if (stale.length === 0) return
    const free = holdReveal({ players: stale.map(([p]) => p) })
    for (const [p, h] of stale) {
      f.held.set(p, { free, at: now })
      h.free(0)
    }
  }

  async function settle(spin: number) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (known.current.has(spin)) return
      try {
        const res = await api.post<SettleResponse>(
          '/api/roulette/settle',
          { spin },
          { key: requestKey() },
        )
        if (res.state === 'drawn') {
          learn(res.result)
          return
        }
        if (res.state === 'empty') {
          flagsFor(spin).empty = true
          bump()
          return
        }
        // Betting is still open by the database's clock: try again at its close.
        await sleep(Math.max(150, res.closesAt - serverNow() + 120))
      } catch {
        await sleep(400 * (attempt + 1))
      }
    }
  }

  const step = useEffectEvent(() => {
    const clock = clockRef.current
    if (!clock) return
    const now = serverNow()
    const { rounds, me, mineOn, pendingOn, reduced, onLanded } = latest.current
    const window = spinAt(clock, now)
    // The room redraws as betting opens and closes, as well as on news.
    const phaseNow = `${window.spin}:${phaseAt(window, now)}`
    if (phaseKey.current !== phaseNow) {
      phaseKey.current = phaseNow
      bump()
    }
    // The spin before this one may still be landing; look at both.
    for (const spin of [window.spin - 1, window.spin]) {
      const w = windowFor(clock, spin)
      if (!w) continue
      const f = flagsFor(spin)
      if (f.landed && f.held.size === 0) continue
      const mine = mineOn(spin) || pendingOn(spin)
      const bettors = bettorsOn(rounds, spin)
      if (mine && !bettors.includes(me)) bettors.push(me)

      // Hold every bettor's news from just before the close until the ball lands.
      if (now >= w.closesAt - HOLD_LEAD_MS && !f.landed && now < w.endsAt + LATE_LIMIT_MS) {
        hold(f, bettors)
        renew(f)
      }

      if (now >= w.closesAt && !f.closed) {
        f.closed = true
        if (bettors.length > 0 && !known.current.has(spin)) {
          f.plan ??= planFor(w, w.closesAt)
          plan.current = f.plan
          if (now - w.closesAt < 600 && !reduced) playLaunch(w.landsAt - w.closesAt - 1_600)
        } else if (bettors.length === 0 && !known.current.has(spin)) {
          f.empty = true
        }
        bump()
      }
      // Bets that land just after the close still spin the wheel.
      if (f.closed && f.empty && bettors.length > 0 && !known.current.has(spin)) {
        f.empty = false
        f.plan ??= planFor(w, Math.max(w.closesAt, now))
        plan.current = f.plan
        bump()
      }

      if (now >= w.closesAt && !known.current.has(spin)) {
        if (mineOn(spin) && !f.settling) {
          f.settling = true
          void sleep(Math.floor(Math.random() * JITTER_MS)).then(() => settle(spin))
        } else if (
          !f.fallback &&
          !f.settling &&
          bettors.length > 0 &&
          now >= w.closesAt + FALLBACK_MS
        ) {
          f.fallback = true
          void settle(spin)
        }
      }

      // Sounds for the bounce and the drop, scheduled once the landing is known.
      const p = f.plan
      if (p && p.number !== null && f.soundsAt !== p.landAt && !reduced) {
        f.soundsAt = p.landAt
        for (const at of bounceTimes(p)) if (at > now) playBounce(at - now)
        if (p.landAt > now) playDrop(p.landAt - now)
      }

      // The ball has landed.
      if (p && p.number !== null && now >= p.landAt && !f.landed) {
        f.landed = true
        landedRef.current = { spin, number: p.number }
        release(f)
        onLanded(spin, p.number)
        bump()
      }
      // A spin with no number by the end of its result time lets go of the news.
      if (!f.landed && now >= w.endsAt + LATE_LIMIT_MS) {
        f.landed = true
        release(f)
        bump()
      }
    }
    // Forget spins long gone.
    for (const spin of flags.current.keys()) {
      if (spin < window.spin - 3) {
        const f = flags.current.get(spin)
        if (f) release(f)
        flags.current.delete(spin)
      }
    }
  })

  // The table's data: the clock and the last numbers, which have landed already.
  useEffect(() => {
    const data = table.data
    if (!data) return
    adopt(data.clock)
    const now = serverNow()
    for (const result of data.recent) {
      const w = data.clock ? windowFor(data.clock, result.spin) : null
      // Fetched mid-spin: the current number still lands at its time.
      learn(result, !w || now >= w.landsAt)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.data])

  useLiveEvent(roomChannel(ROULETTE), 'round.result', (event) => {
    adopt(event.clock)
    learn(event.result)
  })

  // A bet that arrives in the last moment before the close is held at once.
  useLiveEvent(roomChannel(ROULETTE), 'round.started', (round) => {
    const clock = clockRef.current
    const detail = round.detail as RouletteDetail
    if (!clock || typeof detail?.spin !== 'number') return
    const w = windowFor(clock, detail.spin)
    const now = serverNow()
    if (w && now >= w.closesAt - HOLD_LEAD_MS && now < w.landsAt + LATE_LIMIT_MS) {
      hold(flagsFor(detail.spin), [round.userId])
    }
  })

  useEffect(() => {
    const timer = setInterval(step, STEP_MS)
    step()
    return () => clearInterval(timer)
  }, [])

  // Let go of every hold when the room closes.
  useEffect(() => {
    const all = flags.current
    return () => {
      for (const f of all.values()) release(f)
    }
  }, [])

  // ---------------------------------------------------------------- what the room draws
  const clock = clockRef.current
  const now = serverNow()
  const window = clock ? spinAt(clock, now) : null
  const phase = window ? phaseAt(window, now) : null

  // The table shows the previous spin while it is still landing.
  let shown = window
  if (clock && window) {
    const previous = windowFor(clock, window.spin - 1)
    const f = flags.current.get(window.spin - 1)
    if (previous && f && !f.landed && !f.empty && f.plan) shown = previous
  }
  let stage: Stage | null = null
  let number: number | null = null
  if (shown) {
    const f = flags.current.get(shown.spin)
    if (now < shown.closesAt) stage = 'betting'
    else if (f?.landed && landedRef.current?.spin === shown.spin) {
      stage = 'landed'
      number = landedRef.current.number
    } else if (f?.empty || (!f?.plan && !known.current.has(shown.spin))) stage = 'empty'
    else stage = f?.landed ? 'empty' : 'spinning'
  }

  const recent: SpinResult[] = []
  const landedSpins = [...known.current.values()]
    .filter((k) => {
      const f = flags.current.get(k.result.spin)
      return k.knownAt === 0 || f?.landed === true || (shown && k.result.spin < shown.spin)
    })
    .sort((a, b) => b.result.spin - a.result.spin)
  for (const k of landedSpins) {
    if (recent.length >= RECENT_RESULTS) break
    recent.push(k.result)
  }

  return {
    clock,
    loading: table.isPending,
    failed: table.isError,
    retry: () => void refetch(),
    window,
    phase,
    shown,
    stage,
    number,
    plan,
    recent,
    adopt: (next) => adopt(next),
  }
}

/** The times of `spin` on this clock, or null for a spin before its anchor. */
export function windowFor(clock: RouletteClock, spin: number): SpinWindow | null {
  const { anchor, timing } = clock
  if (spin === anchor.spin) return anchor
  if (spin < anchor.spin) return null
  return spinWindow(spin, anchor.endsAt + (spin - anchor.spin - 1) * cycleMs(timing), timing)
}
