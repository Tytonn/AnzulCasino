/**
 * Writing to chat from the server. Players' messages come through
 * POST /api/chat; lanes use this file for everything else.
 *
 * A system post (spec: Social layer > System posts) goes in the same
 * transaction as what it announces, and its event goes out after the commit:
 *
 *   const post = await systemPost(tx, 'Alice won 1,250 on roulette', {
 *     tone: 'win', userId, roundId, game: 'roulette',
 *   })
 *   afterCommit(() => publish([post]))
 *
 * The social lane's GIF endpoint uses insertChatMessage with kind 'gif'.
 */
import { chatMessages } from '../../db/schema/core.ts'
import {
  type ChatKind,
  type ChatMessage,
  cleanChatText,
  type SystemMeta,
} from '../../shared/chat.ts'
import type { Executor } from './db.ts'
import { liveEvent, type Outgoing } from './live.ts'

export interface NewChatMessage {
  /** Null for a system post. */
  userId: string | null
  kind: ChatKind
  body: string
  meta?: Record<string, unknown> | null
}

const columns = {
  id: chatMessages.id,
  userId: chatMessages.userId,
  kind: chatMessages.kind,
  body: chatMessages.body,
  meta: chatMessages.meta,
  createdAt: chatMessages.createdAt,
}

export function toChatMessage(row: {
  id: number
  userId: string | null
  kind: ChatKind
  body: string
  meta: unknown
  createdAt: Date
}): ChatMessage {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    body: row.body,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Saves a message. Plain text only: the body is cleaned the same way as a player's. */
export async function insertChatMessage(
  executor: Executor,
  message: NewChatMessage,
): Promise<ChatMessage> {
  const [row] = await executor
    .insert(chatMessages)
    .values({
      userId: message.userId,
      kind: message.kind,
      body: cleanChatText(message.body),
      meta: message.meta ?? null,
    })
    .returning(columns)
  if (!row) throw new Error('The chat message was not saved.')
  return toChatMessage(row)
}

/** The `chat.message` event for a saved message. Its version is the message id. */
export function chatMessageEvent(message: ChatMessage): Outgoing {
  return liveEvent('chat', 'chat.message', message, message.id)
}

/** Saves a system post and returns its event, to publish after the commit. */
export async function systemPost(
  executor: Executor,
  body: string,
  meta: SystemMeta = {},
): Promise<Outgoing> {
  const message = await insertChatMessage(executor, {
    userId: null,
    kind: 'system',
    body,
    meta: { ...meta },
  })
  return chatMessageEvent(message)
}

export { columns as chatMessageColumns }
