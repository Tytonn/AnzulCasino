/**
 * The browser's live client (src/live/client.ts), driven by a fake transport:
 * each event once, refetching whenever events may have been missed, one
 * online entry per player, and recovering from drops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LiveEnvelope, LiveTokenResponse } from '../../../shared/events.ts'
import {
  createLiveClient,
  type LiveClient,
  RESYNC_AFTER_HIDDEN_MS,
  type Visibility,
} from '../../../src/live/client.ts'
import { onlinePlayers, readPresence } from '../../../src/live/presence.ts'
import type { PresenceMember, Transport, TransportEvents } from '../../../src/live/transport.ts'

const TOKEN: LiveTokenResponse = {
  transport: 'local',
  prefix: 't',
  clientId: 'me',
  token: 'signed',
  url: '/__live',
}

let sequence = 0
function envelope(data: unknown, version = 1, id = `e${++sequence}`): LiveEnvelope {
  return { id, at: Date.now(), version, data }
}

function member(clientId: string, connectionId: string, data: unknown, timestamp = 1) {
  return { clientId, connectionId, data, timestamp } satisfies PresenceMember
}

class FakeTransport implements Transport {
  attached = new Map<string, boolean>()
  shared: unknown[] = []
  members: PresenceMember[] = []
  closed = false
  readonly events: TransportEvents
  constructor(events: TransportEvents) {
    this.events = events
  }
  attach(channel: string, options?: { presence?: boolean }) {
    this.attached.set(channel, Boolean(options?.presence))
  }
  detach(channel: string) {
    this.attached.delete(channel)
  }
  async enterPresence(channel: string, data: unknown) {
    this.shared.push({ channel, data })
  }
  async leavePresence() {}
  async presenceMembers() {
    return this.members
  }
  close() {
    this.closed = true
  }
}

function fakeVisibility() {
  let hidden = false
  const listeners = new Set<() => void>()
  const visibility: Visibility = {
    hidden: () => hidden,
    subscribe(onChange) {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
  }
  return {
    visibility,
    set(next: boolean) {
      hidden = next
      for (const listener of listeners) listener()
    },
  }
}

let transports: FakeTransport[]
let fetchToken: ReturnType<typeof vi.fn<() => Promise<LiveTokenResponse>>>
let screen: ReturnType<typeof fakeVisibility>
let client: LiveClient

const latest = () => transports.at(-1) as FakeTransport
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  transports = []
  fetchToken = vi.fn(async () => TOKEN)
  screen = fakeVisibility()
  client = createLiveClient({
    fetchToken,
    connect: async (_token, events) => {
      const transport = new FakeTransport(events)
      transports.push(transport)
      return transport
    },
    visibility: screen.visibility,
  })
})

afterEach(() => {
  client.stop()
  vi.useRealTimers()
})

async function connected() {
  client.start()
  await flush()
  latest().events.state('connected')
  await flush()
}

describe('connecting', () => {
  it('listens to presence, then shares this tab once connected', async () => {
    const statuses: string[] = []
    client.onStatus(() => statuses.push(client.status))
    client.start()
    await flush()
    expect(client.status).toBe('connecting')
    expect(latest().attached.get('t:presence')).toBe(true)
    expect(latest().shared).toEqual([])

    latest().events.state('connected')
    await flush()
    expect(statuses).toEqual(['connecting', 'connected'])
    expect(latest().shared).toEqual([
      { channel: 't:presence', data: { room: null, status: 'active' } },
    ])
  })

  it('stays off without a transport, and when signed out', async () => {
    fetchToken.mockResolvedValueOnce({ transport: 'none' })
    client.start()
    await flush()
    expect(client.status).toBe('off')
    expect(transports).toEqual([])

    client.stop()
    fetchToken.mockRejectedValueOnce(Object.assign(new Error('401'), { status: 401 }))
    client.start()
    await flush()
    expect(client.status).toBe('off')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchToken).toHaveBeenCalledTimes(2)
  })

  it('retries a failed token request with growing waits', async () => {
    fetchToken.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('again'))
    client.start()
    await flush()
    expect(transports).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchToken).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchToken).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(transports).toHaveLength(1)
  })

  it('replaces a failed transport with a fresh token and ignores the old one', async () => {
    await connected()
    const first = latest()
    const got: unknown[] = []
    client.on('chat', 'chat.deleted', (data) => got.push(data))

    first.events.state('failed')
    expect(first.closed).toBe(true)
    expect(client.status).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(transports).toHaveLength(2)
    expect(latest().attached.has('t:chat')).toBe(true)

    first.events.message('t:chat', 'chat.deleted', envelope({ id: 1 }))
    latest().events.state('connected')
    latest().events.message('t:chat', 'chat.deleted', envelope({ id: 2 }))
    expect(got).toEqual([{ id: 2 }])
  })

  it('stops quietly: the connection closes and late events are ignored', async () => {
    await connected()
    const got: unknown[] = []
    client.on('chat', 'chat.deleted', (data) => got.push(data))
    const transport = latest()
    client.stop()
    expect(transport.closed).toBe(true)
    expect(client.status).toBe('off')
    transport.events.message('t:chat', 'chat.deleted', envelope({ id: 1 }))
    expect(got).toEqual([])
  })
})

describe('events', () => {
  it('reach listeners of that channel and name, once each', async () => {
    await connected()
    const settled: unknown[] = []
    const off = client.on('room:coinflip', 'round.settled', (data, meta) =>
      settled.push([data, meta.version]),
    )
    expect(latest().attached.has('t:room:coinflip')).toBe(true)

    const repeat = envelope({ roundId: 1 }, 7)
    latest().events.message('t:room:coinflip', 'round.settled', repeat)
    latest().events.message('t:room:coinflip', 'round.settled', repeat)
    latest().events.message('t:room:coinflip', 'round.started', envelope({ roundId: 2 }))
    latest().events.message('t:room:mines', 'round.settled', envelope({ roundId: 3 }))
    expect(settled).toEqual([[{ roundId: 1 }, 7]])

    off()
    expect(latest().attached.has('t:room:coinflip')).toBe(false)
  })

  it('keep a channel attached until its last listener leaves', async () => {
    await connected()
    const a = client.on('feed', 'standing.changed', () => {})
    const b = client.on('feed', 'round.settled', () => {})
    a()
    expect(latest().attached.has('t:feed')).toBe(true)
    b()
    expect(latest().attached.has('t:feed')).toBe(false)
  })

  it('survive a listener that throws', async () => {
    await connected()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const got: unknown[] = []
    client.on('chat', 'chat.deleted', () => {
      throw new Error('boom')
    })
    client.on('chat', 'chat.deleted', (data) => got.push(data))
    latest().events.message('t:chat', 'chat.deleted', envelope({ id: 9 }))
    expect(got).toEqual([{ id: 9 }])
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('resync', () => {
  it('fires on the first connect, after a discontinuity, and once per burst', async () => {
    const resyncs = vi.fn()
    client.onResync(resyncs)
    await connected()
    await vi.advanceTimersByTimeAsync(50)
    expect(resyncs).toHaveBeenCalledTimes(1)

    latest().events.state('disconnected')
    expect(client.status).toBe('reconnecting')
    latest().events.state('connected')
    latest().events.discontinuity()
    latest().events.discontinuity()
    await vi.advanceTimersByTimeAsync(50)
    expect(resyncs).toHaveBeenCalledTimes(2)

    // A reconnect that resumed lost nothing, so it does not refetch.
    latest().events.state('disconnected')
    latest().events.state('connected')
    await vi.advanceTimersByTimeAsync(50)
    expect(resyncs).toHaveBeenCalledTimes(2)
  })

  it('fires when the tab comes back after a while, not after a glance away', async () => {
    const resyncs = vi.fn()
    await connected()
    await vi.advanceTimersByTimeAsync(50)
    client.onResync(resyncs)

    screen.set(true)
    await vi.advanceTimersByTimeAsync(5_000)
    screen.set(false)
    await vi.advanceTimersByTimeAsync(50)
    expect(resyncs).not.toHaveBeenCalled()

    screen.set(true)
    await vi.advanceTimersByTimeAsync(RESYNC_AFTER_HIDDEN_MS)
    screen.set(false)
    await vi.advanceTimersByTimeAsync(50)
    expect(resyncs).toHaveBeenCalledTimes(1)
  })
})

describe('presence', () => {
  it('shows one entry per player, from the members and what changes after', async () => {
    client.start()
    await flush()
    latest().members = [
      member('alice', 'a1', { room: 'coinflip', status: 'away' }, 1),
      member('alice', 'a2', { room: 'blackjack', status: 'playing' }, 2),
      member('bob', 'b1', { room: null, status: 'active' }, 1),
    ]
    latest().events.state('connected')
    await flush()
    expect(client.online).toEqual([
      { userId: 'alice', room: 'blackjack', status: 'playing', updatedAt: 2 },
      { userId: 'bob', room: null, status: 'active', updatedAt: 1 },
    ])

    const changes = vi.fn()
    client.onOnline(changes)
    latest().events.presence('t:presence', 'leave', member('alice', 'a2', null))
    expect(client.online.find((p) => p.userId === 'alice')).toMatchObject({
      room: 'coinflip',
      status: 'away',
    })
    latest().events.presence('t:presence', 'leave', member('alice', 'a1', null))
    latest().events.presence('t:presence', 'enter', member('carol', 'c1', { status: 'active' }))
    expect(client.online.map((p) => p.userId)).toEqual(['bob', 'carol'])
    expect(changes).toHaveBeenCalledTimes(3)

    // The same state again is not a change.
    latest().events.presence('t:presence', 'update', member('carol', 'c1', { status: 'active' }))
    expect(changes).toHaveBeenCalledTimes(3)
  })

  it('keeps what happens while the member list loads', async () => {
    client.start()
    await flush()
    let release!: (members: PresenceMember[]) => void
    latest().presenceMembers = () => new Promise((resolve) => (release = resolve))
    latest().events.state('connected')
    latest().events.presence('t:presence', 'leave', member('bob', 'b1', null))
    latest().events.presence('t:presence', 'enter', member('dana', 'd1', { status: 'active' }))
    release([member('bob', 'b1', { status: 'active' }), member('carol', 'c1', {})])
    await flush()
    expect(client.online.map((p) => p.userId)).toEqual(['carol', 'dana'])
  })

  it('shares room and status changes as one update, and skips repeats', async () => {
    await connected()
    const transport = latest()
    transport.shared = []
    client.setRoom('coinflip')
    client.setPlaying(true)
    await vi.advanceTimersByTimeAsync(150)
    expect(transport.shared).toEqual([
      { channel: 't:presence', data: { room: 'coinflip', status: 'playing' } },
    ])

    client.setRoom('coinflip')
    client.setPlaying(false)
    client.setPlaying(true)
    await vi.advanceTimersByTimeAsync(150)
    expect(transport.shared).toHaveLength(1)

    client.setAway(true)
    await vi.advanceTimersByTimeAsync(150)
    expect(transport.shared.at(-1)).toEqual({
      channel: 't:presence',
      data: { room: 'coinflip', status: 'away' },
    })
  })

  it('shares again on a new connection, which starts with nothing', async () => {
    await connected()
    client.setRoom('mines')
    await vi.advanceTimersByTimeAsync(150)
    latest().shared = []
    latest().events.state('disconnected')
    latest().events.state('connected')
    await flush()
    expect(latest().shared).toEqual([
      { channel: 't:presence', data: { room: 'mines', status: 'active' } },
    ])
  })
})

describe('presence data from other browsers', () => {
  it('is checked before anyone sees it', () => {
    expect(readPresence({ room: 'coinflip', status: 'playing' })).toEqual({
      room: 'coinflip',
      status: 'playing',
    })
    expect(readPresence({ room: '<img src=x>', status: 'hacking' })).toEqual({
      room: null,
      status: 'active',
    })
    expect(readPresence('nonsense')).toEqual({ room: null, status: 'active' })
    expect(readPresence(null)).toEqual({ room: null, status: 'active' })
    expect(readPresence({ room: 'x'.repeat(41) }).room).toBeNull()
  })

  it('merges tabs: the busiest status, the latest room', () => {
    expect(
      onlinePlayers([
        member('a', '1', { room: 'mines', status: 'active' }, 5),
        member('a', '2', { room: 'slots', status: 'away' }, 9),
      ]),
    ).toEqual([{ userId: 'a', room: 'slots', status: 'active', updatedAt: 9 }])
  })
})
