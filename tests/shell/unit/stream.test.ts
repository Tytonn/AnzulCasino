/**
 * Which filter shows what (spec: The stream). The database's filters in
 * server/core/stream.ts follow the same rule, and the integration test
 * holds the two together.
 */
import { describe, expect, it } from 'vitest'

import {
  type ChatMessage,
  filterShows,
  STREAM_FILTERS,
  type StreamTopic,
  streamTopic,
} from '../../../shared/chat.ts'

const item = (kind: ChatMessage['kind'], meta: Record<string, unknown> | null = null) => ({
  kind,
  meta,
})

describe('streamTopic', () => {
  it('reads each kind of item', () => {
    expect(streamTopic(item('player'))).toBe('chat')
    expect(streamTopic(item('gif', { url: 'x' }))).toBe('chat')
    expect(streamTopic(item('card', { game: 'blackjack', roundId: 1 }))).toBe('game')
    expect(streamTopic(item('system'))).toBe('news')
    expect(streamTopic(item('system', { tone: 'info', category: 'news' }))).toBe('news')
    expect(streamTopic(item('system', { tone: 'win', category: 'game' }))).toBe('game')
  })

  it('leaves out a big result its round card already shows', () => {
    expect(streamTopic(item('system', { category: 'game', onCard: true }))).toBeNull()
  })
})

describe('filterShows', () => {
  const shows = (topic: StreamTopic | null) =>
    STREAM_FILTERS.filter((filter) => filterShows(filter, topic))

  it('shows chat under Everything and Chat only', () => {
    expect(shows('chat')).toEqual(['all', 'chat'])
  })

  it('shows games under Everything and Games only', () => {
    expect(shows('game')).toEqual(['all', 'games'])
  })

  it('shows announcements under every filter, and hidden items under none', () => {
    expect(shows('news')).toEqual(['all', 'chat', 'games'])
    expect(shows(null)).toEqual([])
  })
})
