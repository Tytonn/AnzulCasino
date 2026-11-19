/**
 * Rank unlock posts (spec: Economy > Ranks: "announce each unlock in chat").
 * Each rank unlocks at the 4:00 AM Central reset that starts its unlock day,
 * and the first request after that posts it once. A rank that unlocked more
 * than a day before anyone came by is recorded without a post, and one whose
 * unlock falls on or after the final day is never announced, since it cannot
 * be bought this season.
 */
import { chipCount, formatChips } from '../../../shared/chips.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import { tierLadder } from '../../../shared/features/economy.ts'
import { finalDayStartsAt } from '../../../shared/features/season.ts'
import { TIER_LABELS } from '../../../shared/tiers.ts'
import { db } from '../../lib/db.ts'
import type { Outgoing } from '../../lib/live.ts'
import { announce, announced } from '../season/announce.ts'
import { dueAt, isDue } from '../season/moments.ts'
import type { SeasonRow } from '../season/lifecycle.ts'

const NEWS_MS = 24 * 3_600_000

export function unlockText(tier: keyof typeof TIER_LABELS, price: bigint, perDay: bigint): string {
  return (
    `🔓 ${TIER_LABELS[tier]} rank is open: ${chipCount(price)} for ` +
    `${formatChips(perDay)} a day in income. Buy it in the Shop.`
  )
}

export async function announceUnlocks(
  season: SeasonRow,
  config: ConfigValues,
  now: Date,
): Promise<Outgoing[]> {
  const key = `unlock:${season.id}`
  if (!isDue(key, now) || now < season.startsAt || now >= season.endsAt) return []

  const closesAt = finalDayStartsAt(season.endsAt, config.final_freeze_hours)
  const ladder = tierLadder(config, season.startsAt).filter(
    (step) => step.tier !== 'base' && step.unlocksAt < closesAt,
  )
  const unlocked = ladder.filter((step) => step.unlocksAt <= now)
  const upcoming = ladder.filter((step) => step.unlocksAt > now)
  const nextAt = upcoming.reduce<Date | null>(
    (soonest, step) => (soonest === null || step.unlocksAt < soonest ? step.unlocksAt : soonest),
    null,
  )
  if (unlocked.length === 0) {
    dueAt(key, nextAt, now)
    return []
  }

  const events = await db().transaction(async (tx) => {
    const done = await announced(tx, season.id)
    const posts: Outgoing[] = []
    for (const step of unlocked) {
      if (done.has(`unlock:${step.tier}`)) continue
      // A rank open from day 1 is news from the season's start.
      const since = Math.max(step.unlocksAt.getTime(), season.startsAt.getTime())
      posts.push(
        ...(await announce(tx, {
          seasonId: season.id,
          key: `unlock:${step.tier}`,
          body: unlockText(step.tier, step.price, step.perDay),
          post: now.getTime() - since < NEWS_MS,
        })),
      )
    }
    return posts
  })
  dueAt(key, nextAt, now)
  return events
}
