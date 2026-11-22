/**
 * Keeping the stream current (spec: Live events): a new item goes into each
 * filter's list that shows it, a deleted one leaves them all, and every
 * card's round moves on with its room's events, a shared card's with
 * `shared.updated`. The shell's LiveSync calls these for chat news;
 * <CardFeeds /> listens to the rooms while the stream is open.
 */
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { createElement } from 'react'

import { type ChatMessage, STREAM_FILTERS } from '../../../shared/chat.ts'
import { roomChannel } from '../../../shared/events.ts'
import type { RoundView, SharedRoundView } from '../../../shared/rounds.ts'
import { putRound, putSharedRound } from '../../kit/cards.ts'
import { useMe } from '../../kit/queries.ts'
import { useLiveEvent } from '../../live/index.ts'
import { games } from '../registry.ts'
import { addItem, removeItem, streamKey, type StreamList } from './cache.ts'
import { cardSharedRoundId } from './fold.ts'
import { pinCard } from './pins.ts'

/** Puts an item in each loaded list whose filter shows it, and a card's round in the store. */
export function addToStream(queryClient: QueryClient, message: ChatMessage): void {
  if (message.kind === 'card' && message.round) putRound(message.round)
  if (message.kind === 'card' && message.sharedRound) putSharedRound(message.sharedRound)
  for (const filter of STREAM_FILTERS) {
    queryClient.setQueryData<StreamList>(streamKey(filter), (old) => addItem(old, message, filter))
  }
}

export function removeFromStream(queryClient: QueryClient, id: number): void {
  for (const filter of STREAM_FILTERS) {
    queryClient.setQueryData<StreamList>(streamKey(filter), (old) => removeItem(old, id))
  }
}

/** The newest item the player can see now: a private reply goes right after it. */
export function newestId(queryClient: QueryClient): number {
  let newest = 0
  for (const filter of STREAM_FILTERS) {
    const last = queryClient.getQueryData<StreamList>(streamKey(filter))?.items.at(-1)
    if (last && last.id > newest) newest = last.id
  }
  return newest
}

/** A shared round's card in any loaded list of the stream. */
function sharedCardIn(queryClient: QueryClient, id: number): ChatMessage | undefined {
  for (const filter of STREAM_FILTERS) {
    const items = queryClient.getQueryData<StreamList>(streamKey(filter))?.items
    const card = items?.find((m) => m.kind === 'card' && cardSharedRoundId(m) === id)
    if (card) return card
  }
  return undefined
}

function RoomFeed({ game }: { game: string }) {
  const channel = roomChannel(game)
  const me = useMe()
  const queryClient = useQueryClient()
  const put = (round: unknown) => putRound(round as RoundView)
  useLiveEvent(channel, 'round.started', put)
  useLiveEvent(channel, 'round.action', put)
  useLiveEvent(channel, 'round.settled', put)
  useLiveEvent(channel, 'shared.updated', (data) => {
    const view = data as SharedRoundView
    putSharedRound(view)
    // A bet of yours from another tab pins its card here too while betting is open.
    if (view.settledAt === null && view.rounds.some((r) => r.userId === me.id)) {
      const card = sharedCardIn(queryClient, view.id)
      if (card) pinCard(card)
    }
  })
  return null
}

/** Each game's room events, so every card in the stream plays out live. */
export function CardFeeds() {
  return games
    .filter((game) => game.manifest)
    .map((game) => createElement(RoomFeed, { key: game.id, game: game.id }))
}
