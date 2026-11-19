/**
 * Chat posts that go out once per season: each rank unlock, the final day,
 * the end. The economy_announcements row is written in the same transaction
 * as the post, and its primary key lets only one request write it, so two
 * requests at the same moment never post twice.
 */
import { and, eq } from 'drizzle-orm'

import { economyAnnouncements } from '../../../db/schema/economy.ts'
import type { SystemMeta } from '../../../shared/chat.ts'
import { insertChatMessage, chatMessageEvent } from '../../lib/chat.ts'
import type { Tx } from '../../lib/db.ts'
import type { Outgoing } from '../../lib/live.ts'

export interface Announcement {
  seasonId: number
  /** Such as unlock:silver, final_day or ended. */
  key: string
  body: string
  meta?: SystemMeta & Record<string, unknown>
  /**
   * False records the moment without a post, for news that is too old to
   * announce (a rank that unlocked while nobody was online for days).
   */
  post?: boolean
}

/**
 * Posts an announcement unless it already went out. Returns the event to
 * publish after the commit, or nothing.
 */
export async function announce(tx: Tx, a: Announcement): Promise<Outgoing[]> {
  const [claimed] = await tx
    .insert(economyAnnouncements)
    .values({ seasonId: a.seasonId, key: a.key })
    .onConflictDoNothing()
    .returning({ key: economyAnnouncements.key })
  if (!claimed || a.post === false) return []

  const message = await insertChatMessage(tx, {
    userId: null,
    kind: 'system',
    body: a.body,
    meta: { tone: 'info', ...a.meta },
  })
  await tx
    .update(economyAnnouncements)
    .set({ messageId: message.id })
    .where(and(eq(economyAnnouncements.seasonId, a.seasonId), eq(economyAnnouncements.key, a.key)))
  return [chatMessageEvent(message)]
}

/** Which of these keys have gone out this season. */
export async function announced(tx: Tx, seasonId: number): Promise<Set<string>> {
  const found = await tx
    .select({ key: economyAnnouncements.key })
    .from(economyAnnouncements)
    .where(eq(economyAnnouncements.seasonId, seasonId))
  return new Set(found.map((row) => row.key))
}
