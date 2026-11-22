/**
 * Pure helpers behind the heist screens: the state as of now (a 4:00 AM
 * reset since the last fetch starts a clean day without a request, so an idle
 * tab never wakes the database), the target list with each player's odds or
 * the reason they cannot be robbed, and live steals folded into the cache.
 */
import type { ConfigValues } from '../../../shared/config.ts'
import {
  checkTarget,
  dailyLossCap,
  type HeistState,
  type StealResult,
  type TargetCheck,
  type TargetInfo,
} from '../../../shared/features/heist.ts'
import { gameDay, nextReset } from '../../../shared/game-day.ts'
import type { SeasonPhase, StandingView } from '../../../shared/seasons.ts'
import type { Wire } from '../../../shared/wire.ts'

/** The config heist reads, with chip amounts back as bigint chips. */
export type HeistConfig = Pick<
  ConfigValues,
  | 'steal_attempts_per_day'
  | 'steal_success_pct'
  | 'steal_base_rate'
  | 'steal_per_rank'
  | 'steal_max_rate'
  | 'steal_down_rate'
  | 'daily_loss_cap_pct'
  | 'steal_fine_pct'
  | 'steal_min_fine'
  | 'immunity_hours'
  | 'steal_floor'
  | 'steal_min_take'
  | 'extra_steal_price_pct'
  | 'extra_steal_price_min'
  | 'shield_max_charges'
  | 'shield_weekly_limit'
  | 'shield_price_pct'
  | 'shield_price_min'
  | 'vault_cap_pct'
  | 'final_freeze_hours'
>

export function heistConfig(wire: Wire<ConfigValues> | ConfigValues): HeistConfig {
  return {
    steal_attempts_per_day: wire.steal_attempts_per_day,
    steal_success_pct: wire.steal_success_pct,
    steal_base_rate: wire.steal_base_rate,
    steal_per_rank: wire.steal_per_rank,
    steal_max_rate: wire.steal_max_rate,
    steal_down_rate: wire.steal_down_rate,
    daily_loss_cap_pct: wire.daily_loss_cap_pct,
    steal_fine_pct: wire.steal_fine_pct,
    steal_min_fine: BigInt(wire.steal_min_fine),
    immunity_hours: wire.immunity_hours,
    steal_floor: BigInt(wire.steal_floor),
    steal_min_take: BigInt(wire.steal_min_take),
    extra_steal_price_pct: wire.extra_steal_price_pct,
    extra_steal_price_min: BigInt(wire.extra_steal_price_min),
    shield_max_charges: wire.shield_max_charges,
    shield_weekly_limit: wire.shield_weekly_limit,
    shield_price_pct: wire.shield_price_pct,
    shield_price_min: BigInt(wire.shield_price_min),
    vault_cap_pct: wire.vault_cap_pct,
    final_freeze_hours: wire.final_freeze_hours,
  }
}

/**
 * The heist state as of `now`. Once the daily reset has passed since it was
 * fetched, the new game day starts clean: attempts, the extra attempt, the
 * vault move and who you tried are back, and each player's loss cap is
 * worked out again from their net worth on the leaderboard. Once the season
 * week has ended, the weekly shield count starts over too.
 */
export function heistAsOf(
  state: HeistState,
  now: number,
  cfg: Pick<HeistConfig, 'steal_attempts_per_day' | 'daily_loss_cap_pct'>,
  netWorthOf: (userId: string) => number | undefined,
  myNetWorth: number,
): HeistState & { rolled: boolean } {
  let next: HeistState = state
  let rolled = false
  if (Date.parse(state.nextResetAt) <= now) {
    rolled = true
    const at = new Date(now)
    const cap = (worth: number | undefined) =>
      Number(dailyLossCap(BigInt(Math.max(0, worth ?? 0)), cfg.daily_loss_cap_pct))
    next = {
      ...next,
      gameDay: gameDay(at),
      nextResetAt: nextReset(at).toISOString(),
      me: {
        ...next.me,
        attemptsUsed: 0,
        attemptsAllowed: cfg.steal_attempts_per_day,
        extraBought: false,
        vaultMoved: false,
        stolenToday: 0,
        lossCap: cap(myNetWorth),
      },
      targets: next.targets.map((t) => ({
        ...t,
        triedToday: false,
        capLeft: cap(netWorthOf(t.userId)),
      })),
    }
  }
  const weekEnds = next.me.weekEndsAt ? Date.parse(next.me.weekEndsAt) : null
  if (weekEnds !== null && weekEnds <= now) {
    rolled = true
    next = {
      ...next,
      me: {
        ...next.me,
        shieldsThisWeek: 0,
        weekEndsAt: new Date(weekEnds + 7 * 86_400_000).toISOString(),
      },
    }
  }
  return { ...next, rolled }
}

/** One player in the target list: their place, what a steal would take, or why not. */
export interface TargetRow {
  standing: StandingView
  info: TargetInfo | undefined
  /**
   * Whether you can rob them now. Out of attempts, it says `no_attempts` only
   * for a player the extra attempt would let you rob; anyone else shows their
   * own block (tried today, immune, too poor).
   */
  check: TargetCheck
  /** The same check as if you had an attempt left: what they are worth robbing. */
  worth: TargetCheck
  /** Milliseconds of immunity left, 0 when not immune. */
  immuneLeft: number
}

/** Every other player on the leaderboard, best first, with their odds or their block. */
export function targetRows(input: {
  standings: readonly StandingView[]
  meId: string
  state: HeistState
  phase: SeasonPhase | null
  now: number
  cfg: HeistConfig
}): TargetRow[] {
  const { standings, meId, state, phase, now, cfg } = input
  const mine = standings.find((s) => s.userId === meId)
  const thief = { id: meId, rank: mine?.rank ?? standings.length + 1 }
  const attemptsLeft = Math.max(0, state.me.attemptsAllowed - state.me.attemptsUsed)
  const infos = new Map(state.targets.map((t) => [t.userId, t]))
  return standings
    .filter((s) => s.userId !== meId)
    .map((standing) => {
      const info = infos.get(standing.userId)
      const immuneUntil = info?.immuneUntil ? Date.parse(info.immuneUntil) : null
      const capLeft =
        info !== undefined
          ? BigInt(info.capLeft)
          : dailyLossCap(BigInt(Math.max(0, standing.netWorth)), cfg.daily_loss_cap_pct)
      const facts = {
        phase,
        thief,
        target: {
          id: standing.userId,
          rank: standing.rank,
          balance: BigInt(standing.balance),
          netWorth: BigInt(standing.netWorth),
        },
        attemptsLeft,
        triedToday: info?.triedToday ?? false,
        immuneUntil,
        now,
        capLeft,
        cfg,
      }
      const check = checkTarget(facts)
      const worth = attemptsLeft > 0 ? check : checkTarget({ ...facts, attemptsLeft: 1 })
      return {
        standing,
        info,
        // Out of attempts, a player you could not rob anyway (tried today,
        // immune, too poor) says why, instead of offering the extra attempt.
        check: !check.ok && check.reason === 'no_attempts' && !worth.ok ? worth : check,
        worth,
        immuneLeft: immuneUntil !== null ? Math.max(0, immuneUntil - now) : 0,
      }
    })
}

/**
 * Folds a steal attempt from the live feed into the cached state: the
 * target's immunity and what is left of their cap, and the thief's attempt.
 * Your own steal's answer says how many attempts you have used
 * (`attemptsUsed`), which is set rather than added, so it counts once even
 * when a fresh copy of the state already holds it.
 * Returns 'refetch' when the attempt belongs to a day this state does not
 * hold, so it is fetched again instead.
 */
export function applySteal(
  state: HeistState,
  steal: Pick<
    StealResult,
    'seasonId' | 'gameDay' | 'thiefId' | 'targetId' | 'outcome' | 'amount' | 'immuneUntil'
  >,
  meId: string,
  attemptsUsed?: number,
): HeistState | 'refetch' {
  if (state.seasonId !== steal.seasonId) return 'refetch'
  if (state.gameDay !== steal.gameDay) return 'refetch'
  const taken = steal.outcome === 'success' ? steal.amount : 0
  const me = { ...state.me }
  if (steal.thiefId === meId) {
    me.attemptsUsed =
      attemptsUsed === undefined ? me.attemptsUsed + 1 : Math.max(me.attemptsUsed, attemptsUsed)
  }
  if (steal.targetId === meId) {
    me.stolenToday += taken
    if (steal.immuneUntil) me.immuneUntil = steal.immuneUntil
  }
  const targets = state.targets.map((t) =>
    t.userId === steal.targetId
      ? {
          ...t,
          immuneUntil: steal.immuneUntil ?? t.immuneUntil,
          capLeft: Math.max(0, t.capLeft - taken),
          triedToday: t.triedToday || steal.thiefId === meId,
        }
      : t,
  )
  return { ...state, me, targets }
}

/** "3h", "45m", "2h 5m": how long immunity lasts, for a sentence. */
export function shortDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest}m`
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/**
 * "2h05", "4:59": your immunity on the top bar, short enough for a button the
 * size of the economy's and written like their cooldowns. It rounds down, like
 * the kit's countdown in the button's label.
 */
export function barCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** "3 hours", "1 hour", "90 minutes": a config's hours in words. */
export function hoursInWords(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} minutes`
  return hours === 1 ? '1 hour' : `${hours} hours`
}
