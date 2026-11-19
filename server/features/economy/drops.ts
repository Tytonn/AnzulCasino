/**
 * Chat drops (spec: Economy > Giveaways): at random times a pot lands in
 * chat, and the first `chat_drop_winners` players to grab it split
 * `chat_drop_pot` evenly. The server decides every claim, one per player per
 * drop.
 *
 * No timer runs. The next drop waits as a row whose time nobody can see, a
 * random time between half and one and a half times
 * `chat_drop_every_minutes` after the last one, and it lands on the first
 * request after that time, so drops only land while someone is around. A
 * drop stays open until its shares are gone or the next drop lands.
 */
import { and, desc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import { economyDropClaims, economyDrops } from '../../../db/schema/economy.ts'
import { chipCount, formatChips } from '../../../shared/chips.ts'
import type { ConfigValues } from '../../../shared/config.ts'
import {
  type DropPostMeta,
  dropDelaySeconds,
  dropShare,
  type DropView,
  RECENT_DROPS,
} from '../../../shared/features/economy.ts'
import { chatMessageEvent, insertChatMessage } from '../../lib/chat.ts'
import { db, type Executor, type Tx } from '../../lib/db.ts'
import { ApiError } from '../../lib/errors.ts'
import type { Outgoing } from '../../lib/live.ts'
import { randomBelow } from '../../lib/rng.ts'
import { dueAt, isDue } from '../season/moments.ts'
import type { SeasonRow } from '../season/lifecycle.ts'

/** Schedules the next drop, unless one is already waiting. */
async function scheduleNext(executor: Executor, seasonId: number, config: ConfigValues) {
  const delay = dropDelaySeconds(config.chat_drop_every_minutes, randomBelow)
  await executor
    .insert(economyDrops)
    .values({ seasonId, appearsAt: sql`now() + make_interval(secs => ${delay})` })
    .onConflictDoNothing()
}

export function dropText(pot: bigint, winners: number, share: bigint): string {
  if (winners === 1) return `💰 Chat drop! ${chipCount(pot)} for the first to grab it.`
  return `💰 Chat drop! ${chipCount(pot)} for the first ${winners} to grab it: ${formatChips(share)} each.`
}

/**
 * Lands the season's waiting drop if its time has come, and schedules the
 * next. Returns the chat post's event to publish. Costs no query until the
 * remembered landing time has passed.
 */
export async function landDrop(
  season: SeasonRow,
  config: ConfigValues,
  now: Date,
): Promise<Outgoing[]> {
  const key = `drop:${season.id}`
  if (!isDue(key, now) || now < season.startsAt || now >= season.endsAt) return []

  let [waiting] = await db()
    .select({ id: economyDrops.id, appearsAt: economyDrops.appearsAt })
    .from(economyDrops)
    .where(and(eq(economyDrops.seasonId, season.id), isNull(economyDrops.postedAt)))
  if (!waiting) {
    await scheduleNext(db(), season.id, config)
    ;[waiting] = await db()
      .select({ id: economyDrops.id, appearsAt: economyDrops.appearsAt })
      .from(economyDrops)
      .where(and(eq(economyDrops.seasonId, season.id), isNull(economyDrops.postedAt)))
    if (!waiting) return []
  }
  if (now < waiting.appearsAt) {
    dueAt(key, waiting.appearsAt, now)
    return []
  }

  const id = waiting.id
  const events = await db().transaction(async (tx) => {
    // Another request may be landing it right now: leave it to that one.
    const [drop] = await tx
      .select({ id: economyDrops.id })
      .from(economyDrops)
      .where(
        and(
          eq(economyDrops.id, id),
          isNull(economyDrops.postedAt),
          sql`${economyDrops.appearsAt} <= now()`,
          sql`now() < (select ends_at from seasons where id = ${season.id})`,
        ),
      )
      .for('update', { skipLocked: true })
    if (!drop) return []

    const pot = config.chat_drop_pot
    const winners = config.chat_drop_winners
    const share = dropShare(pot, winners)
    let posted: Outgoing[] = []
    let messageId: number | null = null
    if (share > 0n) {
      const meta: DropPostMeta = {
        tone: 'win',
        drop: { id, pot: Number(pot), winners, share: Number(share) },
      }
      const message = await insertChatMessage(tx, {
        userId: null,
        kind: 'system',
        body: dropText(pot, winners, share),
        meta: { ...meta },
      })
      messageId = message.id
      posted = [chatMessageEvent(message)]
    }
    // A drop too small to share is recorded as landed and skipped.
    await tx
      .update(economyDrops)
      .set({ pot, winners, postedAt: sql`now()`, messageId })
      .where(eq(economyDrops.id, id))
    await scheduleNext(tx, season.id, config)
    return posted
  })
  // Remember the next one's time on the next request.
  dueAt(key, now, now)
  return events
}

/** The season's latest drops, newest first, with who grabbed them. */
export async function recentDrops(
  executor: Executor,
  seasonId: number,
  seasonRunning: boolean,
): Promise<DropView[]> {
  const drops = await executor
    .select({
      id: economyDrops.id,
      messageId: economyDrops.messageId,
      pot: economyDrops.pot,
      winners: economyDrops.winners,
      postedAt: economyDrops.postedAt,
    })
    .from(economyDrops)
    .where(
      and(
        eq(economyDrops.seasonId, seasonId),
        isNotNull(economyDrops.postedAt),
        isNotNull(economyDrops.messageId),
      ),
    )
    .orderBy(desc(economyDrops.id))
    .limit(RECENT_DROPS)
  if (drops.length === 0) return []

  const claims = await executor
    .select({
      dropId: economyDropClaims.dropId,
      userId: economyDropClaims.userId,
      amount: economyDropClaims.amount,
    })
    .from(economyDropClaims)
    .where(
      inArray(
        economyDropClaims.dropId,
        drops.map((d) => d.id),
      ),
    )
    .orderBy(economyDropClaims.createdAt, economyDropClaims.userId)

  // Only the newest drop that landed can still be grabbed.
  const [newest] = await executor
    .select({ id: economyDrops.id })
    .from(economyDrops)
    .where(and(eq(economyDrops.seasonId, seasonId), isNotNull(economyDrops.postedAt)))
    .orderBy(desc(economyDrops.id))
    .limit(1)

  return drops.map((d) => {
    const mine = claims.filter((c) => c.dropId === d.id)
    return {
      id: d.id,
      messageId: d.messageId,
      pot: Number(d.pot),
      winners: d.winners,
      share: Number(dropShare(d.pot, d.winners)),
      postedAt: (d.postedAt as Date).toISOString(),
      open: seasonRunning && d.id === newest?.id && mine.length < d.winners,
      claims: mine.map((c) => ({ userId: c.userId, amount: Number(c.amount) })),
    }
  })
}

export interface DropClaim {
  dropId: number
  amount: bigint
  claims: number
  winners: number
}

/**
 * Grabs a share of a drop for the player. Locks the drop, so its shares go
 * one at a time, then checks it is the newest, still has shares, and the
 * player has none yet. The caller pays the share.
 */
export async function claimDrop(
  tx: Tx,
  seasonId: number,
  userId: string,
  dropId: number,
): Promise<DropClaim> {
  const [drop] = await tx
    .select({
      id: economyDrops.id,
      pot: economyDrops.pot,
      winners: economyDrops.winners,
      postedAt: economyDrops.postedAt,
      messageId: economyDrops.messageId,
    })
    .from(economyDrops)
    .where(and(eq(economyDrops.id, dropId), eq(economyDrops.seasonId, seasonId)))
    .for('update')
  if (!drop || drop.postedAt === null || drop.messageId === null) {
    throw new ApiError(404, 'no_drop', 'That drop is not there. Reload the chat and try again.')
  }

  const [newer] = await tx
    .select({ id: economyDrops.id })
    .from(economyDrops)
    .where(
      and(
        eq(economyDrops.seasonId, seasonId),
        isNotNull(economyDrops.postedAt),
        gt(economyDrops.id, dropId),
      ),
    )
    .limit(1)
  if (newer) {
    throw new ApiError(409, 'drop_closed', 'That drop has closed: a newer one has landed.')
  }

  const taken = await tx
    .select({ userId: economyDropClaims.userId })
    .from(economyDropClaims)
    .where(eq(economyDropClaims.dropId, dropId))
  if (taken.some((c) => c.userId === userId)) {
    throw new ApiError(409, 'drop_claimed', 'You already grabbed a share of this drop.')
  }
  if (taken.length >= drop.winners) {
    const shares = drop.winners === 1 ? 'It is' : `All ${drop.winners} shares are`
    throw new ApiError(409, 'drop_empty', `Too slow! ${shares} gone.`)
  }

  const amount = dropShare(drop.pot, drop.winners)
  if (amount <= 0n) throw new ApiError(409, 'drop_empty', 'That drop is empty.')
  await tx.insert(economyDropClaims).values({ dropId, seasonId, userId, amount })
  return { dropId, amount, claims: taken.length + 1, winners: drop.winners }
}
