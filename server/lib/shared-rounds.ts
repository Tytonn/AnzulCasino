/**
 * Rounds the whole table shares (docs/LANE_GUIDE.md section 8): roulette's
 * spin now, and crash's climb and the race later. The game owns its
 * shared_rounds rows (their states, times and result), and each player's
 * stake on one is a round of theirs made with `play.start({ sharedRoundId })`.
 * This file shows a shared round in the stream, on one card for everyone:
 *
 *   const view = await sharedRoundView(tx, id)               // every player's round on it
 *   const card = await postSharedCard(rt, game, id, 'Roulette · Round 12', view)
 *   rt.emit(sharedRoundEvent(view))                           // shared.updated, after the commit
 *
 * The view never holds the shared round's secret, and its version grows with
 * every bet and with the result (sharedRoundVersion in shared/rounds.ts).
 */
import { and, eq, inArray, sql } from 'drizzle-orm'

import { chatMessages, sharedRounds } from '../../db/schema/core.ts'
import type { ChatMessage, SharedCardMeta } from '../../shared/chat.ts'
import { roomChannel } from '../../shared/events.ts'
import { sharedRoundVersion } from '../../shared/rounds.ts'
import { chatMessageColumns, insertChatMessage, toChatMessage } from './chat.ts'
import type { Executor } from './db.ts'
import { liveEvent, type Outgoing } from './live.ts'
import { type RoundOut, type RoundTx, roundViewsOnShared, type ServerGame } from './rounds.ts'

/** A shared round as browsers see it (SharedRoundView), before its chips become numbers. */
export interface SharedRoundOut<D = unknown, R = unknown> {
  id: number
  game: string
  roundNo: number
  state: string
  opensAt: string
  closesAt: string
  settledAt: string | null
  result: R | null
  rounds: RoundOut<D>[]
  version: number
}

/** Never the secret column. */
const viewColumns = {
  id: sharedRounds.id,
  game: sharedRounds.game,
  roundNo: sharedRounds.roundNo,
  state: sharedRounds.state,
  opensAt: sharedRounds.opensAt,
  closesAt: sharedRounds.closesAt,
  settledAt: sharedRounds.settledAt,
  result: sharedRounds.result,
}

/** The public views of some shared rounds, by id, each with every player's round on it. */
export async function sharedRoundViews(
  executor: Executor,
  ids: readonly number[],
): Promise<Map<number, SharedRoundOut>> {
  const views = new Map<number, SharedRoundOut>()
  if (ids.length === 0) return views
  const rows = await executor
    .select(viewColumns)
    .from(sharedRounds)
    .where(inArray(sharedRounds.id, [...ids]))
  const rounds = await roundViewsOnShared(
    executor,
    rows.map((row) => row.id),
  )
  for (const row of rows) {
    const on = rounds.get(row.id) ?? []
    views.set(row.id, {
      id: row.id,
      game: row.game,
      roundNo: row.roundNo,
      state: row.state,
      opensAt: row.opensAt.toISOString(),
      closesAt: row.closesAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
      result: row.result ?? null,
      rounds: on,
      version: sharedRoundVersion({ settledAt: row.settledAt, rounds: on }),
    })
  }
  return views
}

/** One shared round's public view, or null. */
export async function sharedRoundView<D = unknown, R = unknown>(
  executor: Executor,
  id: number,
): Promise<SharedRoundOut<D, R> | null> {
  const view = (await sharedRoundViews(executor, [id])).get(id)
  return (view as SharedRoundOut<D, R> | undefined) ?? null
}

/** `shared.updated` on the game's room channel, for every screen showing the card. */
export function sharedRoundEvent(view: SharedRoundOut): Outgoing {
  return liveEvent(roomChannel(view.game), 'shared.updated', view, view.version)
}

/**
 * Writes a shared round's one card in the stream, in the transaction that
 * opened the round, and queues its `chat.message` with the round as it
 * stands. A second card for the same shared round is refused by the
 * database (chat_messages_card_shared_key).
 */
export async function postSharedCard(
  rt: RoundTx,
  game: ServerGame,
  view: SharedRoundOut,
  body: string,
): Promise<ChatMessage> {
  const meta: SharedCardMeta = { game: game.id, sharedRoundId: view.id }
  const message = await insertChatMessage(rt.tx, {
    userId: null,
    kind: 'card',
    body,
    meta: { ...meta },
  })
  rt.emit(liveEvent('chat', 'chat.message', { ...message, sharedRound: view }, message.id))
  return message
}

/** A shared round's card, or null when it has none. */
export async function sharedCardOf(executor: Executor, id: number): Promise<ChatMessage | null> {
  const [row] = await executor
    .select(chatMessageColumns)
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.kind, 'card'),
        sql`${chatMessages.meta} ->> 'sharedRoundId' = ${String(id)}`,
      ),
    )
  return row ? toChatMessage(row) : null
}
