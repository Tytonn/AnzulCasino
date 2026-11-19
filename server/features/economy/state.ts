/**
 * One player's economy as GET /api/economy/state and every economy action
 * return it (EconomyState in shared/features/economy.ts): rank income, the
 * streak, the three cooldowns, ranks, today's challenges, recent chat drops
 * and the latest results. Private to the player.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'

import { ledger, wallets } from '../../../db/schema/core.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import {
  ACTIVITY_SIZE,
  type ActivityItem,
  ECONOMY_REASONS,
  type EconomyReason,
  type EconomyState,
  nextTier,
  streakBonus,
  streakDays,
  tierLadder,
  type TierStepView,
} from '../../../shared/features/economy.ts'
import { finalDayStartsAt } from '../../../shared/features/season.ts'
import { addGameDays, gameDay, nextReset } from '../../../shared/game-day.ts'
import { isTier, TIER_LABELS } from '../../../shared/tiers.ts'
import { tierSettings } from '../../../shared/config.ts'
import { dbNow, type Executor, type Tx } from '../../lib/db.ts'
import { challengeViews, dayRounds, ensureChallenges } from './challenges.ts'
import { recentDrops } from './drops.ts'
import { incomeClock, readDaily } from './players.ts'
import type { SeasonRow } from '../season/lifecycle.ts'

function activityNote(reason: EconomyReason, meta: Record<string, unknown>): string | null {
  switch (reason) {
    case 'rank_purchase':
    case 'rank_income':
      return typeof meta.tier === 'string' && isTier(meta.tier) ? TIER_LABELS[meta.tier] : null
    case 'daily_bonus':
      return typeof meta.streak === 'number' ? `Day ${meta.streak}` : null
    case 'challenge':
      return typeof meta.challenge === 'string' ? meta.challenge : null
    default:
      return null
  }
}

/** The player's latest economy results, newest first. */
export async function recentActivity(
  executor: Executor,
  seasonId: number,
  userId: string,
): Promise<ActivityItem[]> {
  const found = await executor
    .select({
      id: ledger.id,
      reason: ledger.reason,
      delta: ledger.delta,
      meta: ledger.meta,
      at: ledger.createdAt,
    })
    .from(ledger)
    .where(
      and(
        eq(ledger.seasonId, seasonId),
        eq(ledger.userId, userId),
        eq(ledger.account, 'wallet'),
        inArray(ledger.reason, [...ECONOMY_REASONS]),
      ),
    )
    .orderBy(desc(ledger.id))
    .limit(ACTIVITY_SIZE)
  return found.map((row) => {
    const reason = row.reason as EconomyReason
    const meta = (row.meta ?? {}) as Record<string, unknown>
    return {
      id: row.id,
      reason,
      delta: Number(row.delta),
      line: typeof meta.line === 'string' ? meta.line : null,
      note: activityNote(reason, meta),
      at: row.at.toISOString(),
    }
  })
}

/**
 * Builds the player's economy. Picks today's challenges the first time, so
 * it runs in a transaction. Null when the player has no wallet this season.
 */
export async function economyState(
  tx: Tx,
  season: SeasonRow,
  userId: string,
  config: ConfigValues,
): Promise<EconomyState | null> {
  // The version first: anything that commits after it is newer news.
  const clock = await incomeClock(tx, season.id, userId)
  if (!clock) return null
  const now = await dbNow(tx)
  const running = now >= season.startsAt && now < season.endsAt

  const [wallet] = await tx
    .select({
      tier: wallets.tier,
      work: wallets.workReadyAt,
      hustle: wallets.hustleReadyAt,
      crime: wallets.crimeReadyAt,
    })
    .from(wallets)
    .where(and(eq(wallets.seasonId, season.id), eq(wallets.userId, userId)))
  if (!wallet) return null
  const cooling = (at: Date | null) => (at && at > now ? at.toISOString() : null)

  const today = gameDay(now)
  const todayRow = await readDaily(tx, season.id, userId, today)
  const yesterdayRow = await readDaily(tx, season.id, userId, addGameDays(today, -1))
  const claimedToday = todayRow?.bonusClaimed ?? false
  const days = claimedToday ? Math.max(1, todayRow?.streak ?? 1) : streakDays(yesterdayRow)

  const ladder: TierStepView[] = tierLadder(config, season.startsAt).map((step) => ({
    tier: step.tier,
    price: Number(step.price),
    perDay: Number(step.perDay),
    unlockDay: step.unlockDay,
    unlocksAt: step.unlocksAt.toISOString(),
  }))
  const up = nextTier(wallet.tier)

  const saved = await ensureChallenges(tx, { seasonId: season.id, userId, gameDay: today }, config)
  const rounds = saved.length > 0 ? await dayRounds(tx, season.id, userId, today) : []
  const drops = await recentDrops(tx, season.id, running)
  const activity = await recentActivity(tx, season.id, userId)

  return {
    seasonId: season.id,
    version: clock.version,
    income: {
      tier: wallet.tier,
      perDay: Number(tierSettings(config, wallet.tier).income),
      capHours: config.tier_income_cap_hours,
      since: clock.since.toISOString(),
    },
    streak: {
      claimedToday,
      days,
      bonus: Number(streakBonus(days, config.streak_step, config.streak_max)),
      nextBonus: Number(streakBonus(days + 1, config.streak_step, config.streak_max)),
      maxBonus: Number(config.streak_max),
    },
    cooldowns: {
      work: cooling(wallet.work),
      hustle: cooling(wallet.hustle),
      crime: cooling(wallet.crime),
    },
    ranks: {
      boughtToday: todayRow?.tierBought ?? false,
      next: up ? (ladder.find((step) => step.tier === up) ?? null) : null,
      ladder,
      closesAt: finalDayStartsAt(season.endsAt, config.final_freeze_hours).toISOString(),
    },
    challenges: {
      day: today,
      resetsAt: nextReset(now).toISOString(),
      list: challengeViews(saved, rounds),
    },
    drops,
    activity,
  }
}
