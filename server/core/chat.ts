/**
 * Basic chat (spec: Social layer > Chat): the pages, sending, and an admin
 * deleting a message. The social lane adds reactions and GIFs on top.
 */
import { and, desc, eq, isNull, lt, ne, sql } from 'drizzle-orm'

import { chatMessages } from '../../db/schema/core.ts'
import { CHAT_PAGE_SIZE, type ChatMessage, type ChatPage } from '../../shared/chat.ts'
import { writeAudit } from '../lib/audit.ts'
import {
  chatMessageColumns,
  chatMessageEvent,
  insertChatMessage,
  toChatMessage,
} from '../lib/chat.ts'
import { loadConfig } from '../lib/config.ts'
import { db } from '../lib/db.ts'
import { notFound } from '../lib/errors.ts'
import { liveEvent, type Outgoing } from '../lib/live.ts'
import { enforce } from '../lib/rate-limit.ts'

/**
 * The newest messages, or the page before `before`, oldest first, for the
 * classic chat. Deleted ones and the stream's game cards are left out.
 */
export async function chatPage(options: { before?: number; limit?: number }): Promise<ChatPage> {
  const limit = options.limit ?? CHAT_PAGE_SIZE
  const found = await db()
    .select(chatMessageColumns)
    .from(chatMessages)
    .where(
      and(
        isNull(chatMessages.deletedAt),
        ne(chatMessages.kind, 'card'),
        options.before === undefined ? undefined : lt(chatMessages.id, options.before),
      ),
    )
    .orderBy(desc(chatMessages.id))
    .limit(limit + 1)
  const more = found.length > limit
  return { messages: found.slice(0, limit).reverse().map(toChatMessage), more }
}

/**
 * Sends a player's message. Limited to chat_burst_count messages per
 * chat_burst_seconds for each player, on top of the route's own limit.
 */
export async function sendChat(
  userId: string,
  body: string,
): Promise<{ message: ChatMessage; events: Outgoing[] }> {
  const { chat_burst_count, chat_burst_seconds } = await loadConfig(db())
  await enforce(db(), 'chat.burst', `user:${userId}`, {
    limit: chat_burst_count,
    windowSeconds: chat_burst_seconds,
  })
  const message = await insertChatMessage(db(), { userId, kind: 'player', body })
  return { message, events: [chatMessageEvent(message)] }
}

/** An admin deletes a message. It disappears for everyone; the audit log keeps who and when. */
export async function deleteChat(adminId: string, id: number): Promise<{ events: Outgoing[] }> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .update(chatMessages)
      .set({ deletedAt: sql`now()`, deletedBy: adminId })
      .where(and(eq(chatMessages.id, id), isNull(chatMessages.deletedAt)))
      .returning({ id: chatMessages.id, userId: chatMessages.userId, kind: chatMessages.kind })
    if (!row) throw notFound('That message is already gone.')
    // The text is left out on purpose: a deleted message should stay deleted.
    await writeAudit(tx, {
      actorId: adminId,
      action: 'chat.deleted',
      target: `chat:${row.id}`,
      before: { userId: row.userId, kind: row.kind },
    })
    return { events: [liveEvent('chat', 'chat.deleted', { id: row.id }, row.id)] }
  })
}
