/**
 * Everything a player does in the economy that moves chips. Each action runs
 * in one transaction under the request's idempotency key (rule 5), locks the
 * wallet before it checks anything (rule 4), compares times with the
 * database's now() (rule 8), draws with node:crypto (rule 6), writes one
 * ledger row per change through server/lib/wallet.ts (rule 3), and answers
 * with the wallet and the player's whole economy, so the browser animates
 * without waiting for the live echo.
 */
import { and, eq, sql } from 'drizzle-orm'

import { wallets } from '../../../db/schema/core.ts'
import { retellLine } from '../../../shared/chat.ts'
import { chipCount, formatChips } from '../../../shared/chips.ts'
import { type ConfigValues, tierSettings } from '../../../shared/config.ts'
import { userChannel } from '../../../shared/events.ts'
import {
  accruedIncome,
  type ChallengeClaimResponse,
  challengeProgress,
  type CollectResponse,
  commandName,
  commandSettings,
  describeProgress,
  drawPress,
  type DropClaimResponse,
  type EconomyState,
  type IncomeCommand,
  incomeReason,
  type IncomeResponse,
  flavorLines,
  linesKey,
  nextTier,
  streakBonus,
  streakDays,
  streakMilestone,
  tierUnlocksAt,
  type TierResponse,
  type WalletAfter,
} from '../../../shared/features/economy.ts'
import { addGameDays, gameDay } from '../../../shared/game-day.ts'
import { type Tier, TIER_LABELS } from '../../../shared/tiers.ts'
import type { Wire } from '../../../shared/wire.ts'
import { systemPost } from '../../lib/chat.ts'
import { loadConfig } from '../../lib/config.ts'
import { dbNow, type Tx } from '../../lib/db.ts'
import { ApiError } from '../../lib/errors.ts'
import { chipTransaction, type ChipRequest } from '../../lib/idempotency.ts'
import { liveEvent, type Outgoing, publish, walletEvents } from '../../lib/live.ts'
import { chance, pick, randomBelow } from '../../lib/rng.ts'
import { latestWalletNews } from '../../lib/rounds.ts'
import { runningSeason } from '../../lib/seasons.ts'
import { type Balances, credit, debit, lockWallet, readWallet } from '../../lib/wallet.ts'
import type { SeasonRow } from '../season/lifecycle.ts'
import { dayRounds, savedChallenges } from './challenges.ts'
import { claimDrop } from './drops.ts'
import {
  bumpVersion,
  incomeClock,
  lockDaily,
  lockEconomyPlayer,
  noSeason,
  readDaily,
  requireSeasonRunning,
  restartIncomeClock,
  updateDaily,
} from './players.ts'
import { economyState } from './state.ts'

// ---------------------------------------------------------------- the transaction

/** A request that changes the player's economy, inside its transaction. */
interface EconomyTx {
  tx: Tx
  season: SeasonRow
  userId: string
  displayName: string
  config: ConfigValues
  /** Queues events to publish after the commit. */
  emit(...events: Outgoing[]): void
}

type EconomyRequest = ChipRequest & { user: { id: string; displayName: string } }

async function economyTransaction<T>(
  ctx: EconomyRequest,
  work: (e: EconomyTx) => Promise<T>,
): Promise<Wire<T>> {
  const season = await runningSeason()
  if (!season) throw noSeason()
  return chipTransaction(ctx, async (tx, afterCommit) => {
    const config = await loadConfig(tx)
    const queued: Outgoing[] = []
    afterCommit(() => publish(latestWalletNews(queued)))
    return work({
      tx,
      season,
      userId: ctx.user.id,
      displayName: ctx.user.displayName,
      config,
      emit: (...events) => void queued.push(...events),
    })
  })
}

/**
 * Ends every action: counts the change for the player's other tabs, queues
 * the wallet news, and reads back the wallet and the whole economy.
 */
async function finish(
  e: EconomyTx,
  balances: Balances | null,
): Promise<{ wallet: WalletAfter; state: EconomyState }> {
  const version = await bumpVersion(e.tx, e.season.id, e.userId)
  if (balances) e.emit(...walletEvents(e.season.id, e.userId, balances))
  e.emit(liveEvent(userChannel(e.userId), 'economy.changed', { seasonId: e.season.id }, version))

  let wallet: WalletAfter
  if (balances) {
    wallet = {
      seasonId: e.season.id,
      balance: Number(balances.balance),
      vault: Number(balances.vault),
      version: balances.ledgerId,
    }
  } else {
    const read = await readWallet(e.tx, e.season.id, e.userId)
    if (!read) throw new Error('The player has no wallet')
    wallet = {
      seasonId: e.season.id,
      balance: Number(read.balance),
      vault: Number(read.vault),
      version: read.version,
    }
  }
  const state = await economyState(e.tx, e.season, e.userId, e.config)
  if (!state) throw new Error('The player has no economy')
  return { wallet, state }
}

/** "4 minutes", "1 hour and 5 minutes": how long until something is ready. */
export function waitText(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000))
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const h = hours === 1 ? '1 hour' : `${hours} hours`
  if (rest === 0) return h
  return `${h} and ${rest === 1 ? '1 minute' : `${rest} minutes`}`
}

// ---------------------------------------------------------------- work, the third button, crime

const READY_AT = {
  work: { column: wallets.workReadyAt, key: 'workReadyAt' },
  hustle: { column: wallets.hustleReadyAt, key: 'hustleReadyAt' },
  crime: { column: wallets.crimeReadyAt, key: 'crimeReadyAt' },
} as const

/**
 * A work, slut or crime result as everyone reads it (Tyton, Nov 22, 2026):
 * the flavor line retold about the player, then the amount, such as
 * "tyton parked cars for the high rollers. +4". The stream draws it from
 * the post's `income` meta; this text is what the classic chat shows.
 */
export function incomePostText(name: string, line: string, paid: boolean, amount: bigint): string {
  const sign = paid ? '+' : '−'
  return `${retellLine(line, name)} ${sign}${formatChips(amount)}`
}

/**
 * POST /api/economy/work, /hustle, /crime. Refused while the button cools
 * down, before the season starts and after it ends; open on the final day.
 * Work always pays, even at an empty wallet. The other two pay or fine, and
 * a fine stops at an empty wallet. Every result posts a line in the stream
 * for everyone (Tyton, Nov 22, 2026); a crime that pays `crime_chat_min` or
 * more is marked big there and celebrates.
 */
export function pressButton(ctx: EconomyRequest, command: IncomeCommand) {
  return economyTransaction(ctx, async (e): Promise<IncomeResponse> => {
    await requireSeasonRunning(e.tx, e.season.id, e.config)
    const wallet = await lockWallet(e.tx, e.season.id, e.userId)
    const { column, key } = READY_AT[command]
    const [cooldown] = await e.tx
      .select({
        readyAt: column,
        waitMs: sql<number>`extract(epoch from (${column} - now())) * 1000`,
      })
      .from(wallets)
      .where(and(eq(wallets.seasonId, e.season.id), eq(wallets.userId, e.userId)))
    const waitMs = Number(cooldown?.waitMs ?? 0)
    if (cooldown?.readyAt && waitMs > 0) {
      const name = commandName(command, e.config.hustle_name)
      throw new ApiError(409, 'cooldown', `${name} is ready again in ${waitText(waitMs)}.`, {
        readyAt: cooldown.readyAt.toISOString(),
      })
    }

    // A fine stops at an empty wallet.
    const settings = commandSettings(e.config, command)
    const { paid, drawn, amount } = drawPress(settings, wallet.balance, {
      chance,
      below: randomBelow,
    })
    const line = pick(flavorLines(e.config, linesKey(command, paid)))

    let balances: Balances | null = null
    if (amount > 0n) {
      const change = {
        seasonId: e.season.id,
        userId: e.userId,
        amount,
        reason: incomeReason(command, paid),
        refType: 'economy',
        refId: command,
        meta: paid ? { line } : { line, drawn: Number(drawn) },
      }
      balances = paid ? await credit(e.tx, change) : await debit(e.tx, change)
    }

    const [ready] = await e.tx
      .update(wallets)
      .set({ [key]: sql`now() + make_interval(mins => ${settings.cooldownMinutes})` })
      .where(and(eq(wallets.seasonId, e.season.id), eq(wallets.userId, e.userId)))
      .returning({ readyAt: column })

    const posted = command === 'crime' && paid && amount >= e.config.crime_chat_min
    e.emit(
      await systemPost(e.tx, incomePostText(e.displayName, line, paid, amount), {
        tone: paid ? 'win' : 'loss',
        userId: e.userId,
        category: 'game',
        income: {
          command,
          outcome: paid ? 'paid' : 'fined',
          amount: Number(amount),
          line,
          big: posted,
        },
      }),
    )

    const done = await finish(e, balances)
    return {
      result: {
        command,
        outcome: paid ? 'paid' : 'fined',
        amount: Number(amount),
        drawn: Number(drawn),
        line,
        readyAt: (ready?.readyAt ?? new Date()).toISOString(),
        posted,
      },
      ...done,
    }
  })
}

// ---------------------------------------------------------------- collect

export function streakPostText(name: string, days: number, max: bigint): string {
  return `🔥 ${name} has collected ${days} days in a row. The streak bonus is maxed at ${chipCount(max)} a day.`
}

/**
 * POST /api/economy/collect: rank income since the last collect (at most
 * `tier_income_cap_hours` of it) and, once per game day, the streak bonus.
 */
export function collect(ctx: EconomyRequest) {
  return economyTransaction(ctx, async (e): Promise<CollectResponse> => {
    await requireSeasonRunning(e.tx, e.season.id, e.config)
    const wallet = await lockWallet(e.tx, e.season.id, e.userId)
    await lockEconomyPlayer(e.tx, e.season.id, e.userId)
    const clock = await incomeClock(e.tx, e.season.id, e.userId)
    if (!clock) throw new Error('The player has no wallet')

    const perDay = tierSettings(e.config, wallet.tier).income
    const income = accruedIncome(perDay, clock.elapsedMs, e.config.tier_income_cap_hours)
    const now = await dbNow(e.tx)
    const today = gameDay(now)
    const daily = await lockDaily(e.tx, e.season.id, e.userId, today)
    const { streak_step: step, streak_max: max } = e.config

    let days = daily.streak
    let bonus = 0n
    if (!daily.bonusClaimed) {
      days = streakDays(await readDaily(e.tx, e.season.id, e.userId, addGameDays(today, -1)))
      bonus = streakBonus(days, step, max)
    }
    if (income <= 0n && daily.bonusClaimed) {
      throw new ApiError(
        409,
        'nothing_to_collect',
        'Nothing to collect yet. Your income builds by the minute, so check back soon.',
      )
    }

    let balances: Balances | null = null
    if (income > 0n) {
      balances = await credit(e.tx, {
        seasonId: e.season.id,
        userId: e.userId,
        amount: income,
        reason: 'rank_income',
        refType: 'economy',
        refId: 'collect',
        meta: { tier: wallet.tier },
      })
      await restartIncomeClock(e.tx, e.season.id, e.userId)
    }
    if (!daily.bonusClaimed) {
      await updateDaily(
        e.tx,
        { seasonId: e.season.id, userId: e.userId, gameDay: today },
        { bonusClaimed: true, streak: days },
      )
      if (bonus > 0n) {
        balances = await credit(e.tx, {
          seasonId: e.season.id,
          userId: e.userId,
          amount: bonus,
          reason: 'daily_bonus',
          refType: 'economy',
          refId: today,
          meta: { streak: days },
        })
      }
      if (streakMilestone(days, step, max)) {
        e.emit(
          await systemPost(e.tx, streakPostText(e.displayName, days, max), {
            tone: 'win',
            userId: e.userId,
          }),
        )
      }
    }

    const done = await finish(e, balances)
    return {
      collected: { income: Number(income), bonus: Number(bonus), streak: days },
      ...done,
    }
  })
}

// ---------------------------------------------------------------- ranks

/**
 * POST /api/economy/tier: buys the next rank up. Only once it has unlocked,
 * at most one a game day, never on the final day. Income so far is collected
 * first at the old rate, so a new rank never pays for time before it was
 * bought. The price leaves the game.
 */
export function buyTier(ctx: EconomyRequest, wanted: Tier) {
  return economyTransaction(ctx, async (e): Promise<TierResponse> => {
    const { finalDay } = await requireSeasonRunning(e.tx, e.season.id, e.config)
    if (finalDay) {
      throw new ApiError(409, 'final_day', 'Ranks cannot be bought on the final day.')
    }
    const wallet = await lockWallet(e.tx, e.season.id, e.userId)
    await lockEconomyPlayer(e.tx, e.season.id, e.userId)

    const up = nextTier(wallet.tier)
    if (!up) throw new ApiError(409, 'top_tier', 'You already hold the top rank.')
    const label = TIER_LABELS[up]
    if (wanted !== up) {
      throw new ApiError(409, 'not_next', `You can only buy the next rank up: ${label}.`)
    }
    const settings = tierSettings(e.config, up)
    const now = await dbNow(e.tx)
    if (now < tierUnlocksAt(e.season.startsAt, settings.unlockDay)) {
      throw new ApiError(
        409,
        'tier_locked',
        `${label} unlocks on day ${settings.unlockDay} of the season.`,
      )
    }
    const today = gameDay(now)
    const daily = await lockDaily(e.tx, e.season.id, e.userId, today)
    if (daily.tierBought) {
      throw new ApiError(
        409,
        'tier_bought_today',
        'You already bought a rank today. The next one can wait for the daily reset.',
      )
    }

    // Collect at the old rate first.
    const clock = await incomeClock(e.tx, e.season.id, e.userId)
    if (!clock) throw new Error('The player has no wallet')
    const income = accruedIncome(
      tierSettings(e.config, wallet.tier).income,
      clock.elapsedMs,
      e.config.tier_income_cap_hours,
    )
    let balance = wallet.balance
    if (income > 0n) {
      const paid = await credit(e.tx, {
        seasonId: e.season.id,
        userId: e.userId,
        amount: income,
        reason: 'rank_income',
        refType: 'economy',
        refId: 'collect',
        meta: { tier: wallet.tier },
      })
      balance = paid.balance
    }
    if (balance < settings.price) {
      throw new ApiError(
        400,
        'insufficient_funds',
        `${label} costs ${chipCount(settings.price)}. You have ${chipCount(balance)} in your wallet.`,
        { available: Number(balance) },
      )
    }
    await restartIncomeClock(e.tx, e.season.id, e.userId)

    // The new tier first, so the wallet news carries it.
    await e.tx
      .update(wallets)
      .set({ tier: up })
      .where(and(eq(wallets.seasonId, e.season.id), eq(wallets.userId, e.userId)))
    const balances = await debit(e.tx, {
      seasonId: e.season.id,
      userId: e.userId,
      amount: settings.price,
      reason: 'rank_purchase',
      refType: 'tier',
      refId: up,
      meta: { tier: up },
    })
    await updateDaily(
      e.tx,
      { seasonId: e.season.id, userId: e.userId, gameDay: today },
      { tierBought: true },
    )
    e.emit(
      await systemPost(
        e.tx,
        `⭐ ${e.displayName} ranked up to ${label}: ${formatChips(settings.income)} a day in income.`,
        { tone: 'info', userId: e.userId },
      ),
    )

    const done = await finish(e, balances)
    return {
      bought: { tier: up, price: Number(settings.price), income: Number(settings.income) },
      ...done,
    }
  })
}

// ---------------------------------------------------------------- challenges

/** POST /api/economy/challenges/claim: pays one of today's finished challenges. */
export function claimChallenge(ctx: EconomyRequest, index: number) {
  return economyTransaction(ctx, async (e): Promise<ChallengeClaimResponse> => {
    await requireSeasonRunning(e.tx, e.season.id, e.config)
    await lockWallet(e.tx, e.season.id, e.userId)
    const now = await dbNow(e.tx)
    const today = gameDay(now)
    const daily = await lockDaily(e.tx, e.season.id, e.userId, today)
    const saved = savedChallenges(daily.challenges)
    const challenge = saved[index]
    if (!challenge) {
      throw new ApiError(
        404,
        'no_challenge',
        "That challenge is not on today's list. Reload to see today's.",
      )
    }
    if (challenge.claimedAt) {
      throw new ApiError(409, 'challenge_claimed', 'You already claimed that challenge.')
    }
    const progress = challengeProgress(
      challenge,
      await dayRounds(e.tx, e.season.id, e.userId, today),
    )
    if (progress < challenge.target) {
      throw new ApiError(
        409,
        'challenge_not_done',
        `That challenge is not done yet: ${describeProgress(challenge, progress)}.`,
      )
    }

    let balances: Balances | null = null
    const reward = BigInt(challenge.reward)
    if (reward > 0n) {
      balances = await credit(e.tx, {
        seasonId: e.season.id,
        userId: e.userId,
        amount: reward,
        reason: 'challenge',
        refType: 'challenge',
        refId: `${today}:${index}`,
        meta: { challenge: challenge.id },
      })
    }
    saved[index] = { ...challenge, claimedAt: now.toISOString() }
    await updateDaily(
      e.tx,
      { seasonId: e.season.id, userId: e.userId, gameDay: today },
      { challenges: saved },
    )

    const done = await finish(e, balances)
    return { claimed: { index, reward: Number(reward) }, ...done }
  })
}

// ---------------------------------------------------------------- chat drops

/** POST /api/economy/drops/claim: grabs a share of the open chat drop. */
export function grabDrop(ctx: EconomyRequest, dropId: number) {
  return economyTransaction(ctx, async (e): Promise<DropClaimResponse> => {
    await requireSeasonRunning(e.tx, e.season.id, e.config)
    const claim = await claimDrop(e.tx, e.season.id, e.userId, dropId)
    const balances = await credit(e.tx, {
      seasonId: e.season.id,
      userId: e.userId,
      amount: claim.amount,
      reason: 'chat_drop',
      refType: 'chat_drop',
      refId: dropId,
    })
    e.emit(
      liveEvent(
        'chat',
        'drop.claimed',
        {
          dropId,
          userId: e.userId,
          amount: claim.amount,
          claims: claim.claims,
          winners: claim.winners,
        },
        claim.claims,
      ),
    )
    const done = await finish(e, balances)
    return { claimed: { dropId, amount: Number(claim.amount) }, ...done }
  })
}
