/**
 * Keeping the stream current (spec: Live events): a new item goes into each
 * filter's list that shows it, a deleted one leaves them all, and every
 * card's round moves on with its room's events. The shell's LiveSync calls
 * these for chat news; <CardFeeds /> listens to the rooms while the stream
 * is open.
 */
import type { QueryClient } from '@tanstack/react-query'
import { createElement } from 'react'

import { type ChatMessage, STREAM_FILTERS } from '../../../shared/chat.ts'
import { roomChannel } from '../../../shared/events.ts'
import type { RoundView } from '../../../shared/rounds.ts'
import { putRound } from '../../kit/cards.ts'
import { useLiveEvent } from '../../live/index.ts'
import { games } from '../registry.ts'
import { addItem, removeItem, streamKey, type StreamList } from './cache.ts'

/** Puts an item in each loaded list whose filter shows it, and a card's round in the store. */
export function addToStream(queryClient: QueryClient, message: ChatMessage): void {
  if (message.kind === 'card' && message.round) putRound(message.round)
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

function RoomFeed({ game }: { game: string }) {
  const channel = roomChannel(game)
  const put = (round: unknown) => putRound(round as RoundView)
  useLiveEvent(channel, 'round.started', put)
  useLiveEvent(channel, 'round.action', put)
  useLiveEvent(channel, 'round.settled', put)
  return null
}

/** Each game's room events, so every card in the stream plays out live. */
export function CardFeeds() {
  return games
    .filter((game) => game.manifest)
    .map((game) => createElement(RoomFeed, { key: game.id, game: game.id }))
}
