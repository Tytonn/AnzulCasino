/**
 * The stream (spec: The stream): chat and games in one list. A page holds
 * the newest items of one filter, oldest first, and every card comes with
 * its round's public view, so the browser draws the whole page from one
 * request. Live news moves it on from there: `chat.message` for new items,
 * the rounds' room events for the cards.
 *
 * The filters ask the database, so Chat only still finds 100 messages on a
 * night of a thousand hands. The SQL below and streamTopic() in
 * shared/chat.ts are the same rule; a test holds them together.
 */
import { and, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm'

import { chatMessages, gameRounds, users } from '../../db/schema/core.ts'
import {
  CHAT_PAGE_SIZE,
  type CardMeta,
  type ChatMessage,
  LOOKUP_TOP,
  type LookupInput,
  type LookupSnapshot,
  type SharedCardMeta,
  type StreamFilter,
  type StreamPage,
} from '../../shared/chat.ts'
import { formatChips } from '../../shared/chips.ts'
import { isTier, TIER_LABELS } from '../../shared/tiers.ts'
import { chatMessageColumns, systemPost, toChatMessage } from '../lib/chat.ts'
import { loadConfig } from '../lib/config.ts'
import { db } from '../lib/db.ts'
import { ApiError, badRequest, notFound } from '../lib/errors.ts'
import type { Outgoing } from '../lib/live.ts'
import { roundViewsById } from '../lib/rounds.ts'
import { currentSeason, standings } from '../lib/seasons.ts'
import { sharedRoundViews } from '../lib/shared-rounds.ts'

const t = chatMessages
/** A system post the stream leaves out: a round's big result, which its card shows. */
const onCard = sql`coalesce(${t.meta} ->> 'onCard', '') = 'true'`
const gameNews = sql`coalesce(${t.meta} ->> 'category', 'news') = 'game'`

/** Each filter's rows (see streamTopic and filterShows in shared/chat.ts). */
function filterWhere(filter: StreamFilter): SQL {
  switch (filter) {
    case 'all':
      return sql`not (${t.kind} = 'system' and ${onCard})`
    case 'chat':
      return sql`(${t.kind} in ('player', 'gif') or (${t.kind} = 'system' and not ${onCard} and not ${gameNews}))`
    case 'games':
      return sql`(${t.kind} = 'card' or (${t.kind} = 'system' and not ${onCard}))`
  }
}

/**
 * The player's own cards whose rounds are still open, and the cards of the
 * shared rounds they have a bet on that are still open: they pin above the
 * box under any filter.
 */
async function openCards(userId: string): Promise<ChatMessage[]> {
  const open = await db()
    .select({ id: gameRounds.id, sharedRoundId: gameRounds.sharedRoundId })
    .from(gameRounds)
    .where(and(eq(gameRounds.userId, userId), eq(gameRounds.status, 'open')))
  if (open.length === 0) return []
  const own = open.filter((r) => r.sharedRoundId === null).map((r) => String(r.id))
  const shared = open.flatMap((r) => (r.sharedRoundId === null ? [] : [String(r.sharedRoundId)]))
  const found = await db()
    .select(chatMessageColumns)
    .from(chatMessages)
    .where(
      and(
        eq(t.kind, 'card'),
        isNull(t.deletedAt),
        or(
          own.length > 0 ? inArray(sql`${t.meta} ->> 'roundId'`, own) : undefined,
          shared.length > 0 ? inArray(sql`${t.meta} ->> 'sharedRoundId'`, shared) : undefined,
        ),
      ),
    )
    .orderBy(t.id)
  return found.map(toChatMessage)
}

/** A card's id from its meta: the round's for a player's card, the shared round's for a table's. */
function metaId(message: ChatMessage, key: 'roundId' | 'sharedRoundId'): number {
  const meta = message.meta as Partial<CardMeta & SharedCardMeta> | null
  const id = Number(meta?.[key])
  return Number.isSafeInteger(id) && id > 0 ? id : 0
}

/** Each card with its round, or its shared round, as it is now. */
async function withRounds(messages: ChatMessage[]): Promise<ChatMessage[]> {
  const cards = messages.filter((m) => m.kind === 'card')
  const roundIds = cards.map((m) => metaId(m, 'roundId')).filter((id) => id > 0)
  const sharedIds = cards.map((m) => metaId(m, 'sharedRoundId')).filter((id) => id > 0)
  const [rounds, shared] = await Promise.all([
    roundViewsById(db(), roundIds),
    sharedRoundViews(db(), sharedIds),
  ])
  return messages.map((m) => {
    if (m.kind !== 'card') return m
    const sharedId = metaId(m, 'sharedRoundId')
    if (sharedId > 0) {
      const view = shared.get(sharedId) ?? null
      return { ...m, sharedRound: view as unknown as ChatMessage['sharedRound'] }
    }
    const round = rounds.get(metaId(m, 'roundId')) ?? null
    return { ...m, round: round as unknown as ChatMessage['round'] }
  })
}

/**
 * A page of the stream: the newest items of one filter, or those before
 * `before`. The newest page also lists the player's cards still open, under
 * any filter, so they pin above the box after a reload.
 */
export async function streamPage(
  userId: string,
  input: { filter: StreamFilter; before?: number; limit?: number },
): Promise<StreamPage> {
  const limit = input.limit ?? CHAT_PAGE_SIZE
  const found = await db()
    .select(chatMessageColumns)
    .from(chatMessages)
    .where(
      and(
        isNull(t.deletedAt),
        filterWhere(input.filter),
        input.before === undefined ? undefined : lt(t.id, input.before),
      ),
    )
    .orderBy(desc(t.id))
    .limit(limit + 1)
  const more = found.length > limit
  const items = await withRounds(found.slice(0, limit).reverse().map(toChatMessage))
  const mine = input.before === undefined ? await withRounds(await openCards(userId)) : []
  // The rounds' chip amounts are bigint until the response is written.
  return { filter: input.filter, items, more, mine } as unknown as StreamPage
}

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

/**
 * Posts what .bal or .lb shows, for everyone (stream_bal_lb is public), as
 * it stands now. Refused while the setting keeps them private: then the
 * browser answers the player alone from what it already has.
 */
export async function postLookup(
  userId: string,
  input: LookupInput,
): Promise<{ events: Outgoing[] }> {
  const config = await loadConfig(db())
  if (config.stream_bal_lb !== 'public') {
    throw new ApiError(409, 'lookup_private', 'Balances and the leaderboard answer only you now.')
  }
  const season = await currentSeason()
  if (!season) throw badRequest('There is no season yet, so there is nothing to show.')
  const board = await standings(db(), season.id)

  const [asker] = await db()
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
  const askerName = asker?.name ?? 'Someone'

  if (input.what === 'leaderboard') {
    const top = board.slice(0, LOOKUP_TOP)
    const lookup: LookupSnapshot = {
      kind: 'leaderboard',
      rows: top.map((row) => ({
        userId: row.userId,
        rank: row.rank,
        netWorth: Number(row.netWorth),
      })),
      players: board.length,
    }
    const listed = top.map((row) => `${row.rank}. ${row.displayName} ${formatChips(row.netWorth)}`)
    const body = `${askerName} checked the leaderboard: ${listed.join(' · ') || 'nobody yet'}`
    const post = await systemPost(db(), body, { tone: 'info', userId, category: 'game', lookup })
    return { events: [post] }
  }

  const wanted = input.player?.replace(/^@/, '').toLowerCase()
  const row = wanted
    ? board.find(
        (r) => r.username.toLowerCase() === wanted || r.displayName.toLowerCase() === wanted,
      )
    : board.find((r) => r.userId === userId)
  if (!row) {
    throw notFound(
      wanted
        ? `Nobody called ${input.player} is playing this season.`
        : 'You have no chips this season.',
    )
  }
  const lookup: LookupSnapshot = {
    kind: 'balance',
    userId: row.userId,
    balance: Number(row.balance),
    vault: Number(row.vault),
    tier: row.tier,
    rank: row.rank,
  }
  const tier = isTier(row.tier) ? TIER_LABELS[row.tier] : row.tier
  const whose = row.userId === userId ? askerName : `${askerName} checked ${row.displayName}`
  const body = `${whose}: ${formatChips(row.balance)} in the wallet, ${formatChips(row.vault)} in the vault, ${tier}, ${ordinal(row.rank)} of ${board.length}`
  const post = await systemPost(db(), body, { tone: 'info', userId, category: 'game', lookup })
  return { events: [post] }
}
