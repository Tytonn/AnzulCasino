/**
 * node scripts/simulate-season.ts [--runs 1000] [--seed 1] [--json out.json]
 *
 * The season simulation (spec: Steal, shields and vault > Tune it before the
 * first season). Ten bots with different styles play a 30-day season a
 * thousand times, with the config defaults the site uses (shared/config.ts)
 * and the site's own steal rules (shared/features/heist.ts). It prints:
 *
 * - how often the leader on day 20 wins the season,
 * - what a leader loses to steals per week, average and worst case,
 * - what a typical steal is worth to a bottom-half player,
 * - chips moved by steals against chips won and lost at the tables,
 * - the total chip supply by day, and where the chips came from each week,
 * - the day each rank is first bought, who holds what at the end, the share
 *   of net worth from rank income and giveaways, an early rank buyer against
 *   a player who never buys, and a flag if the top rank is bought by most
 *   players or by none,
 * - work, slut and crime against rank income at each tier.
 *
 * The bots and the games are a model, written down in STYLES and GAMES:
 * about 70 games a player a day with frequent all-ins, the three income
 * buttons pressed whenever they are ready during play hours, a rank bought
 * when a bot can afford it, a steal at the best target, shields for the top
 * three. Everything is seeded, so a run can be repeated exactly.
 */
import { parseArgs } from 'node:util'
import { writeFileSync } from 'node:fs'

import { basisPoints, CHIP, formatChips, formatChipsShort, formatShare } from '../shared/chips.ts'
import { configDefaults, tierSettings } from '../shared/config.ts'
import {
  attemptsAllowed,
  capLeft,
  checkTarget,
  extraAttemptPrice,
  shieldPrice,
  stealFine,
  vaultRoom,
} from '../shared/features/heist.ts'
import { TIER_LABELS, TIERS } from '../shared/tiers.ts'

const cfg = configDefaults()

const DAYS = 30
const DAY_MINUTES = 24 * 60
const PLAYERS = 10
const WEEK = 7
/** The final 24 hours: the last game day. */
const FREEZE_DAY = DAYS - Math.ceil(cfg.final_freeze_hours / 24) + 1

// ---------------------------------------------------------------- random numbers

/** A small seeded generator (sfc32), so every run can be repeated. */
function generator(seed: number): () => number {
  let a = 0x9e3779b9 ^ seed
  let b = 0x243f6a88 ^ Math.imul(seed, 0x85ebca6b)
  let c = 0xb7e15162 ^ Math.imul(seed, 0xc2b2ae35)
  let d = 0x13198a2e ^ (seed >>> 1)
  const next = () => {
    a >>>= 0
    b >>>= 0
    c >>>= 0
    d >>>= 0
    let t = (a + b) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) | 0
    t = (t + d) | 0
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 16; i++) next()
  return next
}

type Random = () => number

/** A whole number of chips from `min` to `max`, both included. */
function between(random: Random, min: bigint, max: bigint): bigint {
  return min + BigInt(Math.floor(random() * Number(max - min + 1n)))
}

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)]
  if (item === undefined) throw new Error('Nothing to pick from.')
  return item
}

// ---------------------------------------------------------------- the games

/**
 * One bet at each game: what it pays back for `stake` (0 when it loses), with
 * the house edge from config where config has one. Blackjack's edge comes
 * from its rules (six decks, dealer stands on 17, 3 to 2, double after
 * split: about 0.5% with basic strategy), roulette's from the single zero.
 */
type GameKey =
  | 'blackjack'
  | 'roulette_even'
  | 'roulette_dozen'
  | 'roulette_straight'
  | 'coinflip'
  | 'crash'
  | 'mines'
  | 'plinko'
  | 'slots'
  | 'race'

const keep = (edgeBp: number) => 1 - edgeBp / 10_000

/** Pays `times` (in hundredths: 250 is 2.5x) with probability `chance`. */
function pays(stake: bigint, times: number, chance: number, random: Random): bigint {
  return random() < chance ? (stake * BigInt(times)) / 100n : 0n
}

/** Pays `times` with the chance that leaves the house its edge. */
function fair(stake: bigint, times: number, edgeBp: number, random: Random): bigint {
  return pays(stake, times, keep(edgeBp) / (times / 100), random)
}

// Slots: a pay table returning 96% before scaling to slots_edge_pct.
const SLOTS_TABLE: [times: number, chance: number][] = [
  [10_000, 0.0006],
  [2_000, 0.006],
  [500, 0.04],
  [200, 0.2],
  [100, 0.18],
]
const SLOTS_SCALE = keep(cfg.slots_edge_pct) / 0.96

const GAMES: Record<GameKey, (stake: bigint, random: Random) => bigint> = {
  blackjack: (stake, random) => {
    // 4.5% naturals at 3 to 2, 8.5% pushes, the rest set for a 0.5% edge.
    const r = random()
    if (r < 0.045) return (stake * 250n) / 100n
    if (r < 0.13) return stake
    if (r < 0.13 + 0.39875) return stake * 2n
    return 0n
  },
  roulette_even: (stake, random) => pays(stake, 200, 18 / 37, random),
  roulette_dozen: (stake, random) => pays(stake, 300, 12 / 37, random),
  roulette_straight: (stake, random) => pays(stake, 3_600, 1 / 37, random),
  coinflip: (stake, random) => pays(stake, 200 - (2 * cfg.coinflip_edge_pct) / 100, 0.5, random),
  crash: (stake, random) =>
    fair(stake, pick(random, [150, 200, 300, 500, 1_000]), cfg.crash_edge_pct, random),
  mines: (stake, random) => fair(stake, pick(random, [130, 200, 500]), cfg.mines_edge_pct, random),
  plinko: (stake, random) =>
    fair(stake, pick(random, [150, 300, 1_000]), cfg.plinko_edge_pct, random),
  slots: (stake, random) => {
    let r = random()
    for (const [times, chance] of SLOTS_TABLE) {
      const scaled = chance * SLOTS_SCALE
      if (r < scaled) return (stake * BigInt(times)) / 100n
      r -= scaled
    }
    return 0n
  },
  race: (stake, random) => fair(stake, pick(random, [200, 400, 800]), cfg.race_edge_pct, random),
}

const STEADY_MIX: [GameKey, number][] = [
  ['blackjack', 5],
  ['roulette_even', 3],
  ['coinflip', 2],
]
const WILD_MIX: [GameKey, number][] = [
  ['crash', 3],
  ['roulette_straight', 1],
  ['roulette_dozen', 1.5],
  ['slots', 2],
  ['mines', 1],
  ['plinko', 0.5],
  ['race', 1],
]
const MIXED_MIX: [GameKey, number][] = [...STEADY_MIX, ...WILD_MIX]

// ---------------------------------------------------------------- the bots

interface Style {
  label: string
  /** Games in a day they log in. */
  games: number
  /** Minutes online in a day they log in: the income buttons are pressed through it. */
  session: number
  /** Chance they log in on a given day. */
  logins: number
  /** A normal bet, in basis points of the wallet. */
  betBp: number
  /** Share of games bet all in, in basis points. */
  allInBp: number
  mix: [GameKey, number][]
  /** Steal attempts they use a day: all of them, or one. */
  steals: 'all' | 'one'
  buyExtra: boolean
  /** Buy a shield charge while in the top three. */
  shields: boolean
  /** Fill the vault while in the top half; take it out when the wallet is empty. */
  vault: boolean
  /** When to buy the next rank: as soon as it is affordable, with half its price to spare, or never. */
  ranks: 'early' | 'reserve' | 'never'
  /** The leader who stops logging in: once first on or after `fromDay`, or on `byDay` regardless. */
  leaves?: { fromDay: number; byDay: number }
}

const STYLES = {
  grinder: {
    label: 'Steady grinder',
    games: 88,
    session: 240,
    logins: 0.95,
    betBp: 200,
    allInBp: 200,
    mix: STEADY_MIX,
    steals: 'one',
    buyExtra: false,
    shields: true,
    vault: true,
    ranks: 'reserve',
  },
  gambler: {
    label: 'All-in gambler',
    games: 98,
    session: 180,
    logins: 0.9,
    betBp: 1_000,
    allInBp: 1_500,
    mix: WILD_MIX,
    steals: 'one',
    buyExtra: false,
    shields: false,
    vault: false,
    ranks: 'early',
  },
  thief: {
    label: 'Constant thief',
    games: 66,
    session: 150,
    logins: 0.95,
    betBp: 300,
    allInBp: 500,
    mix: MIXED_MIX,
    steals: 'all',
    buyExtra: true,
    shields: true,
    vault: false,
    ranks: 'reserve',
  },
  absent: {
    label: 'Leader who stops logging in',
    games: 110,
    session: 300,
    logins: 1,
    betBp: 500,
    allInBp: 800,
    mix: MIXED_MIX,
    steals: 'one',
    buyExtra: false,
    shields: false,
    vault: false,
    ranks: 'reserve',
    leaves: { fromDay: 7, byDay: 12 },
  },
  casual: {
    label: 'Casual',
    games: 44,
    session: 90,
    logins: 0.7,
    betBp: 500,
    allInBp: 500,
    mix: MIXED_MIX,
    steals: 'one',
    buyExtra: false,
    shields: false,
    vault: false,
    ranks: 'reserve',
  },
  buyer: {
    label: 'Early rank buyer',
    games: 88,
    session: 240,
    logins: 0.95,
    betBp: 200,
    allInBp: 300,
    mix: MIXED_MIX,
    steals: 'one',
    buyExtra: false,
    shields: true,
    vault: false,
    ranks: 'early',
  },
  saver: {
    label: 'Never buys a rank',
    games: 88,
    session: 240,
    logins: 0.95,
    betBp: 200,
    allInBp: 300,
    mix: MIXED_MIX,
    steals: 'one',
    buyExtra: false,
    shields: true,
    vault: false,
    ranks: 'never',
  },
} satisfies Record<string, Style>

type StyleKey = keyof typeof STYLES

const ROSTER: StyleKey[] = [
  'grinder',
  'grinder',
  'gambler',
  'gambler',
  'thief',
  'thief',
  'absent',
  'casual',
  'buyer',
  'saver',
]

const SUCCESS = cfg.steal_success_pct / 10_000
const TIER_INFO = TIERS.map((tier) => tierSettings(cfg, tier))
const INCOME_CAP_MINUTES = cfg.tier_income_cap_hours * 60

// ---------------------------------------------------------------- one season

interface Player {
  index: number
  style: Style
  styleKey: StyleKey
  wallet: bigint
  vault: bigint
  tier: number
  // Today.
  attemptsUsed: number
  extraBought: boolean
  tried: Set<number>
  stolenToday: bigint
  netWorthAtReset: bigint
  vaultMoved: boolean
  tierBoughtToday: boolean
  // Shields.
  charges: number
  shieldsThisWeek: number
  /** Season minutes. */
  immuneUntil: number
  // Income.
  lastCollect: number
  streak: number
  lastLogin: number
  online: boolean
  gone: boolean
  goneDay: number
  goneRank: number
  goneNetWorth: bigint
  // What they got and lost, for the report.
  rankIncome: bigint
  buttons: bigint
  giveaways: bigint
  bonuses: bigint
  lostToSteals: bigint
  gainedBySteals: bigint
  buttonDays: number
}

interface Flows {
  rankIncome: bigint
  buttons: bigint
  bonuses: bigint
  giveaways: bigint
  tableWon: bigint
  tableLost: bigint
  ranksBought: bigint
  shields: bigint
  extras: bigint
  stolen: bigint
  fines: bigint
}

const noFlows = (): Flows => ({
  rankIncome: 0n,
  buttons: 0n,
  bonuses: 0n,
  giveaways: 0n,
  tableWon: 0n,
  tableLost: 0n,
  ranksBought: 0n,
  shields: 0n,
  extras: 0n,
  stolen: 0n,
  fines: 0n,
})

interface Season {
  final: bigint[]
  leaderDay20: number
  winner: number
  supply: bigint[]
  weeks: Flows[]
  totals: Flows
  /** What the week's leader lost to steals that week, as a share of their net worth at its start. */
  leaderWeekLoss: number[]
  /** Successful steals by a bottom-half thief, as a share of their own net worth. */
  bottomHalfSteals: number[]
  /** Every attempt by a bottom-half thief, net of fines, as a share of their net worth. */
  bottomHalfAttempts: number[]
  attempts: number
  outcomes: { success: number; failed: number; blocked: number }
  tierFirstDay: (number | null)[]
  tierHolders: number[]
  players: Player[]
  games: number
  activeDays: number
  buttonIncomePerDay: number[]
}

const ranksOf = (players: Player[]) => {
  const worth = players.map((p) => p.wallet + p.vault)
  return players.map((_, i) => 1 + worth.filter((w) => w > (worth[i] ?? 0n)).length)
}

const leaderOf = (players: Player[]) => {
  let best = 0
  players.forEach((p, i) => {
    const top = players[best]
    if (top && p.wallet + p.vault > top.wallet + top.vault) best = i
  })
  return best
}

const EVENT = {
  login: 0,
  buy: 1,
  game: 2,
  work: 3,
  hustle: 4,
  crime: 5,
  steal: 6,
  logout: 7,
} as const
type EventKind = (typeof EVENT)[keyof typeof EVENT]

function simulate(seed: number): Season {
  const random = generator(seed)
  const players: Player[] = ROSTER.map((styleKey, index) => ({
    index,
    style: STYLES[styleKey],
    styleKey,
    wallet: cfg.starting_balance,
    vault: 0n,
    tier: 0,
    attemptsUsed: 0,
    extraBought: false,
    tried: new Set(),
    stolenToday: 0n,
    netWorthAtReset: cfg.starting_balance,
    vaultMoved: false,
    tierBoughtToday: false,
    charges: 0,
    shieldsThisWeek: 0,
    immuneUntil: 0,
    lastCollect: 0,
    streak: 0,
    lastLogin: 0,
    online: false,
    gone: false,
    goneDay: 0,
    goneRank: 0,
    goneNetWorth: 0n,
    rankIncome: 0n,
    buttons: 0n,
    giveaways: 0n,
    bonuses: 0n,
    lostToSteals: 0n,
    gainedBySteals: 0n,
    buttonDays: 0,
  }))
  const season: Season = {
    final: [],
    leaderDay20: 0,
    winner: 0,
    supply: [],
    weeks: Array.from({ length: Math.ceil(DAYS / WEEK) }, noFlows),
    totals: noFlows(),
    leaderWeekLoss: [],
    bottomHalfSteals: [],
    bottomHalfAttempts: [],
    attempts: 0,
    outcomes: { success: 0, failed: 0, blocked: 0 },
    tierFirstDay: TIERS.map((_, i) => (i === 0 ? 0 : null)),
    tierHolders: TIERS.map(() => 0),
    players,
    games: 0,
    activeDays: 0,
    buttonIncomePerDay: [],
  }

  let day = 1
  let flows = season.weeks[0] ?? noFlows()
  const add = (key: keyof Flows, amount: bigint) => {
    flows[key] += amount
    season.totals[key] += amount
  }

  function collect(p: Player, now: number) {
    const perDay = TIER_INFO[p.tier]?.income ?? 0n
    const minutes = Math.min(now - p.lastCollect, INCOME_CAP_MINUTES)
    const income = (perDay * BigInt(Math.floor(minutes))) / BigInt(DAY_MINUTES)
    // Like the site (incomeCarryMs), only the minutes the whole chips paid are
    // worth are used up: the part of a chip still building stays on the clock.
    const used = perDay > 0n ? Math.ceil((Number(income) * DAY_MINUTES) / Number(perDay)) : minutes
    p.lastCollect = now - Math.max(0, minutes - used)
    if (income <= 0n) return
    p.wallet += income
    p.rankIncome += income
    add('rankIncome', income)
  }

  function maybeBuyRank(p: Player, now: number) {
    if (p.style.ranks === 'never' || p.tierBoughtToday || day >= FREEZE_DAY) return
    const next = TIER_INFO[p.tier + 1]
    if (!next || day < next.unlockDay) return
    const needed = p.style.ranks === 'reserve' ? (next.price * 3n) / 2n : next.price
    if (p.wallet < needed) return
    collect(p, now)
    // The part of a chip still building carries over at the new rate (carryAtRate).
    const before = TIER_INFO[p.tier]?.income ?? 0n
    const carry = now - p.lastCollect
    p.lastCollect = next.income > 0n ? now - (carry * Number(before)) / Number(next.income) : now
    p.wallet -= next.price
    p.tier += 1
    p.tierBoughtToday = true
    add('ranksBought', next.price)
    const first = season.tierFirstDay[p.tier]
    if (first === null) season.tierFirstDay[p.tier] = day
  }

  function play(p: Player) {
    if (p.wallet < cfg.min_bet) return
    const style = p.style
    const allIn = random() * 10_000 < style.allInBp
    let stake = allIn ? p.wallet : (basisPoints(p.wallet, style.betBp) / CHIP) * CHIP
    if (stake < cfg.min_bet) stake = cfg.min_bet
    if (stake > p.wallet) stake = p.wallet
    const game = weighted(random, style.mix)
    const back = GAMES[game](stake, random)
    p.wallet += back - stake
    season.games += 1
    if (back > stake) add('tableWon', back - stake)
    else if (back < stake) add('tableLost', stake - back)
  }

  function press(p: Player, kind: EventKind) {
    let change: bigint
    if (kind === EVENT.work) {
      change = between(random, cfg.work_pay_min, cfg.work_pay_max)
    } else {
      const crime = kind === EVENT.crime
      const works = random() * 10_000 < (crime ? cfg.crime_success_pct : cfg.hustle_success_pct)
      if (works) {
        change = crime
          ? between(random, cfg.crime_pay_min, cfg.crime_pay_max)
          : between(random, cfg.hustle_pay_min, cfg.hustle_pay_max)
      } else {
        const fine = crime
          ? between(random, cfg.crime_fine_min, cfg.crime_fine_max)
          : between(random, cfg.hustle_fine_min, cfg.hustle_fine_max)
        change = -(fine < p.wallet ? fine : p.wallet)
      }
    }
    p.wallet += change
    p.buttons += change
    add('buttons', change)
  }

  function steal(thief: Player, now: number) {
    const allowed = attemptsAllowed(cfg.steal_attempts_per_day, thief.extraBought)
    if (thief.attemptsUsed >= allowed) return
    const ranks = ranksOf(players)
    const thiefRank = ranks[thief.index] ?? PLAYERS
    const fine = stealFine(thief.wallet, cfg)
    let best: { target: Player; amount: bigint; value: number } | null = null
    for (const target of players) {
      const check = checkTarget({
        phase: day >= FREEZE_DAY ? 'final_day' : 'open',
        thief: { id: String(thief.index), rank: thiefRank },
        target: {
          id: String(target.index),
          rank: ranks[target.index] ?? PLAYERS,
          balance: target.wallet,
          netWorth: target.wallet + target.vault,
        },
        attemptsLeft: allowed - thief.attemptsUsed,
        triedToday: thief.tried.has(target.index),
        immuneUntil: target.immuneUntil,
        now,
        capLeft: capLeft(target.netWorthAtReset, target.stolenToday, cfg.daily_loss_cap_pct),
        cfg,
      })
      if (!check.ok) continue
      // The thief cannot see shields, so this is the plain odds.
      const value = SUCCESS * Number(check.amount) - (1 - SUCCESS) * Number(fine)
      if (value > 0 && (!best || value > best.value)) best = { target, amount: check.amount, value }
    }
    if (!best) return
    const { target, amount } = best
    const before = thief.wallet + thief.vault
    const bottomHalf = thiefRank > PLAYERS / 2
    thief.attemptsUsed += 1
    thief.tried.add(target.index)
    season.attempts += 1
    let net = 0n
    if (target.charges > 0) {
      target.charges -= 1
      target.immuneUntil = now + cfg.immunity_hours * 60
      season.outcomes.blocked += 1
    } else if (random() < SUCCESS) {
      target.wallet -= amount
      thief.wallet += amount
      target.stolenToday += amount
      target.lostToSteals += amount
      thief.gainedBySteals += amount
      target.immuneUntil = now + cfg.immunity_hours * 60
      season.outcomes.success += 1
      add('stolen', amount)
      net = amount
      if (bottomHalf && before > 0n) season.bottomHalfSteals.push(Number(amount) / Number(before))
    } else {
      thief.wallet -= fine
      target.wallet += fine
      season.outcomes.failed += 1
      add('fines', fine)
      net = -fine
    }
    if (bottomHalf && before > 0n) season.bottomHalfAttempts.push(Number(net) / Number(before))
  }

  function login(p: Player, now: number) {
    p.online = true
    collect(p, now)
    const yesterday = p.lastLogin === day - 1
    if (p.lastLogin !== day) {
      p.streak = yesterday ? p.streak + 1 : 1
      const bonus = BigInt(p.streak) * cfg.streak_step
      const paid = bonus < cfg.streak_max ? bonus : cfg.streak_max
      p.wallet += paid
      p.bonuses += paid
      add('bonuses', paid)
    }
    p.lastLogin = day
    const open = day < FREEZE_DAY
    const rank = ranksOf(players)[p.index] ?? PLAYERS
    if (open && p.style.vault && !p.vaultMoved) {
      if (p.wallet < cfg.min_bet && p.vault > 0n) {
        p.wallet += p.vault
        p.vault = 0n
        p.vaultMoved = true
      } else if (rank <= PLAYERS / 2) {
        const room = vaultRoom(p.wallet, p.vault, cfg.vault_cap_pct)
        if (room > 0n) {
          p.wallet -= room
          p.vault += room
          p.vaultMoved = true
        }
      }
    }
    if (open && p.style.shields && rank <= 3) {
      const price = shieldPrice(p.wallet, cfg)
      if (
        p.charges < cfg.shield_max_charges &&
        p.shieldsThisWeek < cfg.shield_weekly_limit &&
        p.wallet >= price
      ) {
        p.wallet -= price
        p.charges += 1
        p.shieldsThisWeek += 1
        add('shields', price)
      }
    }
    if (open && p.style.buyExtra && !p.extraBought) {
      const price = extraAttemptPrice(p.wallet, cfg)
      if (p.wallet >= price * 5n) {
        p.wallet -= price
        p.extraBought = true
        add('extras', price)
      }
    }
    maybeBuyRank(p, now)
  }

  function logout(p: Player, now: number, played: number) {
    collect(p, now)
    p.online = false
    if (played >= 10) {
      for (let i = 0; i < cfg.challenges_per_day; i++) {
        if (random() < 0.7) {
          const reward = between(random, cfg.challenge_reward_min, cfg.challenge_reward_max)
          p.wallet += reward
          p.bonuses += reward
          add('bonuses', reward)
        }
      }
    }
  }

  for (day = 1; day <= DAYS; day++) {
    flows = season.weeks[Math.floor((day - 1) / WEEK)] ?? noFlows()
    const dayStart = (day - 1) * DAY_MINUTES
    const newWeek = (day - 1) % WEEK === 0
    for (const p of players) {
      p.attemptsUsed = 0
      p.extraBought = false
      p.tried.clear()
      p.stolenToday = 0n
      p.netWorthAtReset = p.wallet + p.vault
      p.vaultMoved = false
      p.tierBoughtToday = false
      if (newWeek) p.shieldsThisWeek = 0
    }

    // The leader at the start of a week, for what they lose to steals that week.
    const weekStart = day >= 2 && (day - 2) % WEEK === 0 && day + WEEK - 1 < FREEZE_DAY
    if (weekStart) {
      const leader = players[leaderOf(players)]
      if (leader) weekWatch.push({ leader, kept: 1, endDay: day + WEEK - 1 })
    }

    // Who logs in today, when, and what they do.
    const events: { t: number; kind: EventKind; p: Player }[] = []
    const sessions: { p: Player; start: number; end: number; played: number }[] = []
    for (const p of players) {
      if (p.gone || random() >= p.style.logins) continue
      const length = p.style.session
      // Evenings, Central time: the reset is 4:00 AM, so 6 PM is 14 hours in.
      const start = 12 * 60 + random() * 8 * 60
      const end = Math.min(DAY_MINUTES - 1, start + length)
      sessions.push({ p, start, end, played: 0 })
      season.activeDays += 1
      p.buttonDays += 1
      events.push({ t: start, kind: EVENT.login, p })
      for (let i = 0; i < p.style.games; i++) {
        events.push({ t: start + random() * (end - start), kind: EVENT.game, p })
      }
      for (let t = start; t < end; t += cfg.work_cooldown_minutes)
        events.push({ t, kind: EVENT.work, p })
      for (let t = start; t < end; t += cfg.hustle_cooldown_minutes)
        events.push({ t, kind: EVENT.hustle, p })
      for (let t = start; t < end; t += cfg.crime_cooldown_minutes)
        events.push({ t, kind: EVENT.crime, p })
      const steals =
        p.style.steals === 'all' ? attemptsAllowed(cfg.steal_attempts_per_day, true) : 1
      for (let i = 0; i < steals; i++) {
        events.push({ t: start + random() * (end - start), kind: EVENT.steal, p })
      }
      events.push({ t: end, kind: EVENT.logout, p })
    }
    events.sort((a, b) => a.t - b.t || a.kind - b.kind)

    // Chat drops land at random while anyone is online, about every chat_drop_every_minutes.
    const drops: number[] = []
    for (
      let t = random() * cfg.chat_drop_every_minutes * 2;
      t < DAY_MINUTES;
      t += random() * cfg.chat_drop_every_minutes * 2
    ) {
      drops.push(t)
    }

    const buttonsBefore = new Map(players.map((p) => [p, p.buttons]))
    const played = new Map<Player, number>()
    let nextDrop = 0
    for (const event of events) {
      while (nextDrop < drops.length && (drops[nextDrop] ?? DAY_MINUTES) <= event.t) {
        const online = players.filter((p) => p.online)
        if (online.length > 0) {
          const winners = shuffle(random, online).slice(0, cfg.chat_drop_winners)
          const share = cfg.chat_drop_pot / BigInt(winners.length)
          for (const w of winners) {
            w.wallet += share
            w.giveaways += share
            add('giveaways', share)
          }
        }
        nextDrop += 1
      }
      const p = event.p
      const now = dayStart + event.t
      switch (event.kind) {
        case EVENT.login:
          login(p, now)
          break
        case EVENT.game:
          play(p)
          played.set(p, (played.get(p) ?? 0) + 1)
          maybeBuyRank(p, now)
          break
        case EVENT.work:
        case EVENT.hustle:
        case EVENT.crime:
          press(p, event.kind)
          break
        case EVENT.steal:
          steal(p, now)
          break
        case EVENT.logout:
          logout(p, now, played.get(p) ?? 0)
          break
      }
    }
    for (const s of sessions) {
      season.buttonIncomePerDay.push(Number(s.p.buttons - (buttonsBefore.get(s.p) ?? 0n)))
    }

    // The end of the day.
    season.supply.push(players.reduce((sum, p) => sum + p.wallet + p.vault, 0n))
    if (day === 20) season.leaderDay20 = leaderOf(players)
    // Each day's loss is a share of their net worth at that day's reset, so
    // what they win or lose at the tables in between does not count.
    for (const watch of weekWatch.splice(0)) {
      const { leader } = watch
      if (leader.netWorthAtReset > 0n) {
        watch.kept *= 1 - Number(leader.stolenToday) / Number(leader.netWorthAtReset)
      }
      if (watch.endDay === day) season.leaderWeekLoss.push(1 - watch.kept)
      else weekWatch.push(watch)
    }
    // The leader who stops logging in.
    for (const p of players) {
      const leaves = p.style.leaves
      if (!leaves || p.gone) continue
      const rank = ranksOf(players)[p.index] ?? PLAYERS
      if ((day >= leaves.fromDay && rank === 1) || day >= leaves.byDay) {
        p.gone = true
        p.goneDay = day
        p.goneRank = rank
        p.goneNetWorth = p.wallet + p.vault
      }
    }
  }

  season.final = players.map((p) => p.wallet + p.vault)
  season.winner = leaderOf(players)
  for (const p of players) season.tierHolders[p.tier] = (season.tierHolders[p.tier] ?? 0) + 1
  return season
}

const weekWatch: { leader: Player; kept: number; endDay: number }[] = []

function weighted<T>(random: Random, items: readonly [T, number][]): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0)
  let r = random() * total
  for (const [item, w] of items) {
    if (r < w) return item
    r -= w
  }
  const last = items[items.length - 1]
  if (!last) throw new Error('No items.')
  return last[0]
}

function shuffle<T>(random: Random, items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) continue
    copy[i] = b
    copy[j] = a
  }
  return copy
}

// ---------------------------------------------------------------- the report

const { values: args } = parseArgs({
  options: {
    runs: { type: 'string', default: '1000' },
    seed: { type: 'string', default: '1' },
    json: { type: 'string' },
  },
})
const RUNS = Math.max(1, Number(args.runs))
const SEED = Number(args.seed)

const started = Date.now()
const seasons: Season[] = []
for (let run = 0; run < RUNS; run++) {
  weekWatch.length = 0
  seasons.push(simulate(SEED * 100_003 + run))
}
const seconds = ((Date.now() - started) / 1000).toFixed(1)

const sorted = (values: number[]) => [...values].sort((a, b) => a - b)
const quantile = (values: number[], q: number) => {
  const s = sorted(values)
  if (s.length === 0) return Number.NaN
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? Number.NaN
}
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '–')
const chips = (amount: number) => formatChips(BigInt(Math.round(amount)))
const short = (amount: number) => formatChipsShort(BigInt(Math.round(amount)))
const table = (rows: string[][]) => {
  const widths = rows[0]?.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? '').length))) ?? []
  return rows
    .map((r) =>
      r
        .map((cell, c) => (c === 0 ? cell.padEnd(widths[c] ?? 0) : cell.padStart(widths[c] ?? 0)))
        .join('   '),
    )
    .join('\n')
}
const lines: string[] = []
const say = (text = '') => lines.push(text)
const flags: string[] = []

say(
  `Season simulation: ${RUNS} seasons of ${DAYS} days, ${PLAYERS} bots, seed ${SEED} (${seconds}s).`,
)
say(
  `Config defaults: start ${formatChips(cfg.starting_balance)} chips; steals ${cfg.steal_attempts_per_day} a day at ${formatShare(cfg.steal_success_pct)}, ` +
    `${formatShare(cfg.steal_base_rate)} + ${formatShare(cfg.steal_per_rank)} a place up to ${formatShare(cfg.steal_max_rate)} (${formatShare(cfg.steal_down_rate)} down), ` +
    `cap ${formatShare(cfg.daily_loss_cap_pct)} a day, fine ${formatShare(cfg.steal_fine_pct)}, vault ${formatShare(cfg.vault_cap_pct)}.`,
)
say()
say('The bots')
say(
  table([
    [
      'Bot',
      'Games a day',
      'Online',
      'Logs in',
      'Bet',
      'All in',
      'Steals',
      'Shields',
      'Vault',
      'Ranks',
    ],
    ...ROSTER.map((key, i) => {
      const s: Style = STYLES[key]
      return [
        `${i + 1}. ${s.label}`,
        String(s.games),
        `${s.session / 60}h`,
        pct(s.logins),
        formatShare(s.betBp),
        formatShare(s.allInBp),
        s.steals === 'all' ? `all${s.buyExtra ? ' + extra' : ''}` : '1',
        s.shields ? 'top 3' : 'no',
        s.vault ? 'yes' : 'no',
        s.ranks,
      ]
    }),
  ]),
)
const gamesPerDay = mean(seasons.map((s) => s.games / Math.max(1, s.activeDays)))
say(
  `Games per player per day online: ${gamesPerDay.toFixed(0)}; per player per season: ${mean(seasons.map((s) => s.games / PLAYERS)).toFixed(0)}.`,
)
say()

// 1. The day-20 leader.
const day20Wins = mean(seasons.map((s) => (s.winner === s.leaderDay20 ? 1 : 0)))
say(`1. The leader on day 20 wins the season in ${pct(day20Wins)} of seasons.`)
say()

// 2. Leader losses per week.
const weekLosses = seasons.flatMap((s) => s.leaderWeekLoss)
const capWeek = 1 - (1 - cfg.daily_loss_cap_pct / 10_000) ** WEEK
say(
  '2. What the leader at the start of a week loses to steals that week, as a share of their net worth:',
)
say(
  `   average ${pct(mean(weekLosses))}, median ${pct(quantile(weekLosses, 0.5))}, 95th percentile ${pct(quantile(weekLosses, 0.95))}, worst ${pct(Math.max(...weekLosses))}.`,
)
say(`   Robbed to the cap every day of a week would be ${pct(capWeek)}.`)
if (quantile(weekLosses, 0.95) > capWeek)
  flags.push('Leaders lose more than the cap-every-day figure in some weeks.')
say()

// 3. A typical steal for a bottom-half player.
const bottom = seasons.flatMap((s) => s.bottomHalfSteals)
const bottomAttempts = seasons.flatMap((s) => s.bottomHalfAttempts)
say('3. A successful steal by a bottom-half player, as a share of their own net worth at the time:')
say(
  `   median ${pct(quantile(bottom, 0.5))}, middle half ${pct(quantile(bottom, 0.25))} to ${pct(quantile(bottom, 0.75))}. (A nearly broke thief can gain many times their worth, so the mean says little.)`,
)
say(
  `   Every attempt they make, fines and blocks included: median ${pct(quantile(bottomAttempts, 0.5))}, middle half ${pct(quantile(bottomAttempts, 0.25))} to ${pct(quantile(bottomAttempts, 0.75))}.`,
)
const outcomes = seasons.reduce(
  (o, s) => ({
    success: o.success + s.outcomes.success,
    failed: o.failed + s.outcomes.failed,
    blocked: o.blocked + s.outcomes.blocked,
  }),
  { success: 0, failed: 0, blocked: 0 },
)
const attempts = outcomes.success + outcomes.failed + outcomes.blocked
say(
  `   Attempts per season: ${(attempts / RUNS).toFixed(0)} (${pct(outcomes.success / attempts)} work, ${pct(outcomes.failed / attempts)} caught, ${pct(outcomes.blocked / attempts)} blocked).`,
)
say()

// 4. Steals against the tables.
const total = (key: keyof Flows) => mean(seasons.map((s) => Number(s.totals[key])))
const stealsMoved = total('stolen') + total('fines')
const tables = total('tableWon') + total('tableLost')
say('4. Chips moved per season:')
say(
  table([
    ['', 'Chips'],
    ['Stolen', chips(total('stolen'))],
    ['Fines for failed steals', chips(total('fines'))],
    ['Won at the tables', chips(total('tableWon'))],
    ['Lost at the tables', chips(total('tableLost'))],
  ]),
)
say(
  `   Steals move ${pct(stealsMoved / tables)} as much as the tables. Gambling stays the bigger number: ${stealsMoved < tables ? 'yes' : 'NO'}.`,
)
if (stealsMoved >= tables) flags.push('Steals move more chips than the tables.')
say()

// 5. Supply by day.
say('5. Total chips in the game (wallets and vaults) at the end of each day, across seasons:')
const supplyRows: string[][] = [['Day', 'Median', '10th pct', '90th pct', 'Average']]
for (let d = 0; d < DAYS; d++) {
  const values = seasons.map((s) => Number(s.supply[d] ?? 0n))
  supplyRows.push([
    String(d + 1),
    short(quantile(values, 0.5)),
    short(quantile(values, 0.1)),
    short(quantile(values, 0.9)),
    short(mean(values)),
  ])
}
say(table(supplyRows))
say()
say('   Where the chips came from and went, per week (averages across seasons):')
const weekCount = Math.ceil(DAYS / WEEK)
const week = (w: number, key: keyof Flows) =>
  mean(seasons.map((s) => Number(s.weeks[w]?.[key] ?? 0n)))
const weekHeads = Array.from({ length: weekCount }, (_, w) => {
  const from = w * WEEK + 1
  return `Days ${from}-${Math.min(DAYS, from + WEEK - 1)}`
})
const flowRow = (label: string, key: keyof Flows, sign = 1) => [
  label,
  ...weekHeads.map((_, w) => short(sign * week(w, key))),
]
say(
  table([
    ['', ...weekHeads],
    flowRow('Rank income', 'rankIncome'),
    flowRow('Work, slut and crime (net)', 'buttons'),
    flowRow('Streak and challenges', 'bonuses'),
    flowRow('Chat drops', 'giveaways'),
    flowRow('Won at the tables', 'tableWon'),
    flowRow('Lost at the tables', 'tableLost', -1),
    flowRow('Ranks bought', 'ranksBought', -1),
    flowRow('Shields', 'shields', -1),
    flowRow('Extra attempts', 'extras', -1),
  ]),
)
const bonusesWeek4 =
  week(3, 'rankIncome') + week(3, 'buttons') + week(3, 'bonuses') + week(3, 'giveaways')
const tableWeek4 = week(3, 'tableWon')
say(
  `   Week four: bonuses ${short(bonusesWeek4)} against ${short(tableWeek4)} won at the tables (${pct(bonusesWeek4 / tableWeek4)}). Bonuses swamp winnings: ${bonusesWeek4 > tableWeek4 ? 'YES' : 'no'}.`,
)
if (bonusesWeek4 > tableWeek4) flags.push('Bonuses outweigh table winnings in week four.')
say()

// 6. Ranks.
say('6. Ranks (tiers in code)')
const tierRows: string[][] = [
  [
    'Rank',
    'Price',
    'Income a day',
    'Unlocks',
    'Bought in',
    'First bought (median day)',
    'Holders at the end',
  ],
]
TIERS.forEach((tier, i) => {
  const info = TIER_INFO[i]
  if (!info) return
  const days = seasons.map((s) => s.tierFirstDay[i]).filter((d): d is number => d !== null)
  const holders = mean(seasons.map((s) => s.tierHolders[i] ?? 0))
  tierRows.push([
    TIER_LABELS[tier],
    i === 0 ? 'free' : formatChips(info.price),
    formatChips(info.income),
    i === 0 ? '–' : `day ${info.unlockDay}`,
    i === 0 ? '–' : pct(days.length / RUNS),
    i === 0 ? '–' : days.length ? String(quantile(days, 0.5)) : 'never',
    holders.toFixed(2),
  ])
})
say(table(tierRows))
const top = TIERS.length - 1
const topHolders = mean(seasons.map((s) => s.tierHolders[top] ?? 0))
const topEver = seasons.filter((s) => s.tierFirstDay[top] !== null).length
if (topHolders > PLAYERS / 2)
  flags.push(`${TIER_LABELS[TIERS[top] ?? 'crown']} is held by most players at the end.`)
if (topEver === 0) flags.push(`Nobody buys ${TIER_LABELS[TIERS[top] ?? 'crown']} in any season.`)
say(
  `   ${TIER_LABELS[TIERS[top] ?? 'crown']}: bought in ${topEver} of ${RUNS} seasons, ${topHolders.toFixed(2)} holders on average. ${topEver === 0 ? 'FLAG: bought by none.' : topHolders > PLAYERS / 2 ? 'FLAG: bought by most.' : 'Neither most nor none.'}`,
)
const finalTotal = mean(seasons.map((s) => Number(s.final.reduce((a, b) => a + b, 0n))))
const inflows: [string, number][] = [
  ['starting balances', Number(cfg.starting_balance) * PLAYERS],
  ['rank income', total('rankIncome')],
  ['work, slut and crime', total('buttons')],
  ['streak and challenges', total('bonuses')],
  ['chat drops', total('giveaways')],
]
const paidIn = inflows.reduce((sum, [, v]) => sum + v, 0)
say(
  `   Of every chip paid into the game in a season: ${inflows.map(([label, v]) => `${label} ${pct(v / paidIn)}`).join(', ')}.`,
)
say(
  `   Against what is left at the end: rank income paid out is ${(total('rankIncome') / finalTotal).toFixed(2)}x the final net worth of all players, chat drops ${(total('giveaways') / finalTotal).toFixed(2)}x. The house edge and rank prices take the rest. Admin giveaways are by hand and not modelled.`,
)
const buyerIndex = ROSTER.indexOf('buyer')
const saverIndex = ROSTER.indexOf('saver')
const buyerFinal = seasons.map((s) => Number(s.final[buyerIndex] ?? 0n))
const saverFinal = seasons.map((s) => Number(s.final[saverIndex] ?? 0n))
const buyerWins = mean(
  seasons.map((s) => ((s.final[buyerIndex] ?? 0n) > (s.final[saverIndex] ?? 0n) ? 1 : 0)),
)
say(
  `   Early rank buyer against the same player who never buys: ahead in ${pct(buyerWins)} of seasons; median finish ${short(quantile(buyerFinal, 0.5))} against ${short(quantile(saverFinal, 0.5))}.`,
)
say()

// 7. The income buttons against rank income.
say('7. Work, slut and crime, pressed whenever ready while online, against rank income:')
const perHour = (minutes: number, every: number) => ((60 / every) * (minutes / 60)) / (minutes / 60)
const workEach = Number(cfg.work_pay_min + cfg.work_pay_max) / 2
const hustleEach =
  (cfg.hustle_success_pct / 10_000) * (Number(cfg.hustle_pay_min + cfg.hustle_pay_max) / 2) -
  (1 - cfg.hustle_success_pct / 10_000) * (Number(cfg.hustle_fine_min + cfg.hustle_fine_max) / 2)
const crimeEach =
  (cfg.crime_success_pct / 10_000) * (Number(cfg.crime_pay_min + cfg.crime_pay_max) / 2) -
  (1 - cfg.crime_success_pct / 10_000) * (Number(cfg.crime_fine_min + cfg.crime_fine_max) / 2)
say(
  `   Expected per press: work ${chips(workEach)}, slut ${chips(hustleEach)}, crime ${chips(crimeEach)}. Per hour online: work ${chips(workEach * perHour(60, cfg.work_cooldown_minutes))}, slut ${chips(hustleEach * perHour(60, cfg.hustle_cooldown_minutes))}, crime ${chips(crimeEach * perHour(60, cfg.crime_cooldown_minutes))}.`,
)
const buttonDays = seasons.flatMap((s) => s.buttonIncomePerDay)
const buttonDay = mean(buttonDays)
say(
  `   Measured: ${chips(buttonDay)} a day for a player online that day (median ${chips(quantile(buttonDays, 0.5))}).`,
)
const hoursRows: string[][] = [
  ['Online a day', 'Buttons a day', ...TIERS.map((t) => TIER_LABELS[t])],
]
for (const hours of [1, 2, 4]) {
  const minutes = hours * 60
  const presses = (every: number) => Math.ceil(minutes / every)
  const daily =
    workEach * presses(cfg.work_cooldown_minutes) +
    hustleEach * presses(cfg.hustle_cooldown_minutes) +
    crimeEach * presses(cfg.crime_cooldown_minutes)
  hoursRows.push([
    `${hours}h`,
    chips(daily),
    ...TIER_INFO.map((info) => `${(Number(info.income) / daily).toFixed(2)}x`),
  ])
}
say('   Rank income as a multiple of the buttons, by hours online:')
say(table(hoursRows))
say()

// 8. The bots.
say('8. How each bot finished (median net worth, how often first):')
say(
  table([
    [
      'Bot',
      'Median finish',
      'First',
      'Lost to steals',
      'Got from steals',
      'Rank income',
      'Buttons',
    ],
    ...ROSTER.map((key, i) => {
      const finals = seasons.map((s) => Number(s.final[i] ?? 0n))
      const firsts = mean(seasons.map((s) => (s.winner === i ? 1 : 0)))
      const of = (k: 'lostToSteals' | 'gainedBySteals' | 'rankIncome' | 'buttons') =>
        short(mean(seasons.map((s) => Number(s.players[i]?.[k] ?? 0n))))
      return [
        `${i + 1}. ${STYLES[key].label}`,
        short(quantile(finals, 0.5)),
        pct(firsts),
        of('lostToSteals'),
        of('gainedBySteals'),
        of('rankIncome'),
        of('buttons'),
      ]
    }),
  ]),
)
const absentIndex = ROSTER.indexOf('absent')
const leaving = seasons
  .map((s) => ({ p: s.players[absentIndex], won: s.winner === absentIndex }))
  .filter((x): x is { p: Player; won: boolean } => !!x.p && x.p.gone)
const kept = (p: Player) => Number(p.wallet + p.vault) / Math.max(1, Number(p.goneNetWorth))
const leftFirst = leaving.filter((x) => x.p.goneRank === 1)
say(
  `   The leader who stops logging in left on day ${quantile(
    leaving.map((x) => x.p.goneDay),
    0.5,
  )} (median), in first place ${pct(leftFirst.length / Math.max(1, leaving.length))} of the time.`,
)
say(
  `   When they left in first place they kept ${pct(
    quantile(
      leftFirst.map((x) => kept(x.p)),
      0.5,
    ),
  )} of their net worth by the end (median; worst ${pct(Math.min(...leftFirst.map((x) => kept(x.p))))}), and still won ${pct(mean(leftFirst.map((x) => (x.won ? 1 : 0))))} of those seasons.`,
)
say()

say(flags.length ? `Flags:\n${flags.map((f) => `- ${f}`).join('\n')}` : 'Flags: none.')

console.log(lines.join('\n'))

if (args.json) {
  writeFileSync(
    args.json,
    JSON.stringify(
      {
        runs: RUNS,
        seed: SEED,
        day20LeaderWins: day20Wins,
        leaderWeekLoss: {
          mean: mean(weekLosses),
          p95: quantile(weekLosses, 0.95),
          worst: Math.max(...weekLosses),
        },
        bottomHalfSteal: { median: quantile(bottom, 0.5), mean: mean(bottom) },
        stealsVsTables: stealsMoved / tables,
        supplyMedianByDay: Array.from({ length: DAYS }, (_, d) =>
          quantile(
            seasons.map((s) => Number(s.supply[d] ?? 0n)),
            0.5,
          ),
        ),
        flags,
      },
      null,
      2,
    ),
  )
}
