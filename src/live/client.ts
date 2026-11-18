/**
 * The live client: one per signed-in tab. It gets a token from the server,
 * connects through whichever transport the token names, and hands events to
 * whoever listens. Listening is all a browser can do; only the server
 * publishes (spec: Live events).
 *
 * What it guarantees to the code above it:
 * - Each event arrives once, even if a transport delivers it twice.
 * - `onResync` fires whenever events may have been missed: on the first
 *   connect, after a reconnect that could not resume, and when the tab comes
 *   back after a while. Refetch there; then drop events whose `version` is
 *   not newer than what you fetched.
 * - `online` is one entry per player, from the presence channel.
 * - A dropped connection recovers by itself, with a fresh token if needed.
 *
 * Use it through the hooks in ./react.tsx. It touches no DOM itself, so the
 * tests drive it with a fake transport.
 */
import type {
  Channel,
  EventName,
  EventsOn,
  LiveEnvelope,
  PresenceData,
} from '../../shared/events.ts'
import { type OnlinePlayer, onlinePlayers, samePlayers } from './presence.ts'
import type {
  PresenceAction,
  PresenceMember,
  RenewToken,
  Transport,
  TransportEvents,
} from './transport.ts'

/** `off`: live updates are not available (none configured, or signed out). Pages still work. */
export type LiveStatus = 'connecting' | 'connected' | 'reconnecting' | 'off'

export type LiveHandler<C extends Channel, N extends EventName<C>> = (
  data: EventsOn<C>[N],
  envelope: LiveEnvelope<EventsOn<C>[N]>,
) => void

/** Builds the transport a token names, or null when there is none. */
export type Connect = (
  token: Awaited<ReturnType<RenewToken>>,
  events: TransportEvents,
  renew: RenewToken,
) => Promise<Transport | null>

export interface Visibility {
  hidden(): boolean
  subscribe(onChange: () => void): () => void
}

export interface LiveClientOptions {
  fetchToken: RenewToken
  connect: Connect
  visibility?: Visibility
}

export interface LiveClient {
  readonly status: LiveStatus
  /** Who is online, one entry per player. The same array until something changes. */
  readonly online: readonly OnlinePlayer[]
  /** Listens to one event on one channel until the returned function is called. */
  on<C extends Channel, N extends EventName<C>>(
    channel: C,
    name: N,
    handler: LiveHandler<C, N>,
  ): () => void
  /** Runs `handler` whenever events may have been missed. Refetch there. */
  onResync(handler: () => void): () => void
  onStatus(handler: () => void): () => void
  onOnline(handler: () => void): () => void
  /** The room this tab is in, shared through presence. */
  setRoom(room: string | null): void
  /** True while this player has a round open. */
  setPlaying(playing: boolean): void
  /** True after a while without input. */
  setAway(away: boolean): void
  start(): void
  stop(): void
}

/** After the tab was hidden at least this long, coming back refetches. */
export const RESYNC_AFTER_HIDDEN_MS = 30_000
/** Event ids remembered for dropping repeats. */
const SEEN_IDS = 500
/** Room and status changes within this window are shared as one update. */
const PRESENCE_DELAY_MS = 150
const MAX_RETRY_MS = 30_000

type AnyHandler = (data: unknown, envelope: LiveEnvelope) => void

function signedOut(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 401
}

export function createLiveClient(options: LiveClientOptions): LiveClient {
  let status: LiveStatus = 'off'
  let started = false
  let prefix = ''
  let transport: Transport | null = null
  /** Bumped whenever a transport is dropped, so its late callbacks are ignored. */
  let generation = 0
  let connectedOnce = false
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let unwatchVisibility: (() => void) | undefined
  let hiddenSince: number | null = null

  const handlers = new Map<Channel, Map<string, Set<AnyHandler>>>()
  const seen = new Set<string>()
  const resyncHandlers = new Set<() => void>()
  const statusHandlers = new Set<() => void>()
  const onlineHandlers = new Set<() => void>()
  let resyncTimer: ReturnType<typeof setTimeout> | undefined

  const members = new Map<string, PresenceMember>()
  /** Presence events that arrive while the member list is being fetched. */
  let presenceBuffer: { action: PresenceAction; member: PresenceMember }[] | null = null
  let online: readonly OnlinePlayer[] = []
  const mine = { room: null as string | null, playing: false, away: false }
  /** What this connection last shared, so an unchanged update is skipped. */
  let shared: PresenceData | null = null
  let presenceTimer: ReturnType<typeof setTimeout> | undefined

  const full = (channel: Channel) => `${prefix}:${channel}`

  function notify(set: Set<() => void>) {
    for (const handler of [...set]) {
      try {
        handler()
      } catch (error) {
        console.error('[live] a listener failed', error)
      }
    }
  }

  function setStatus(next: LiveStatus) {
    if (status === next) return
    status = next
    notify(statusHandlers)
  }

  function queueResync() {
    if (resyncTimer !== undefined) return
    // Several reasons at once (a reconnect on many channels) make one refetch.
    resyncTimer = setTimeout(() => {
      resyncTimer = undefined
      notify(resyncHandlers)
    }, 50)
  }

  function refreshOnline() {
    const next = onlinePlayers(members.values())
    if (samePlayers(online, next)) return
    online = next
    notify(onlineHandlers)
  }

  function applyPresence(action: PresenceAction, member: PresenceMember) {
    if (action === 'leave') members.delete(member.connectionId)
    else members.set(member.connectionId, member)
  }

  function presenceData(): PresenceData {
    return { room: mine.room, status: mine.away ? 'away' : mine.playing ? 'playing' : 'active' }
  }

  function queuePresence() {
    clearTimeout(presenceTimer)
    presenceTimer = setTimeout(() => void sharePresence(), PRESENCE_DELAY_MS)
  }

  async function sharePresence() {
    const current = transport
    if (!current || status !== 'connected') return
    const data = presenceData()
    if (shared && shared.room === data.room && shared.status === data.status) return
    shared = data
    try {
      await current.enterPresence(full('presence'), data)
    } catch (error) {
      shared = null
      console.warn('[live] could not share presence', error)
    }
  }

  /** The member list after a (re)connect, with the events that arrived meanwhile on top. */
  async function loadMembers(current: Transport, gen: number) {
    presenceBuffer = []
    try {
      const list = await current.presenceMembers(full('presence'))
      if (gen !== generation) return
      members.clear()
      for (const member of list) members.set(member.connectionId, member)
      for (const event of presenceBuffer ?? []) applyPresence(event.action, event.member)
    } catch (error) {
      console.warn('[live] could not load who is online', error)
    } finally {
      if (gen === generation) {
        presenceBuffer = null
        refreshOnline()
      }
    }
  }

  function transportEvents(gen: number): TransportEvents {
    return {
      message(channel, name, envelope) {
        if (gen !== generation || typeof envelope?.id !== 'string') return
        if (seen.has(envelope.id)) return
        seen.add(envelope.id)
        if (seen.size > SEEN_IDS) seen.delete(seen.values().next().value as string)
        const listeners = handlers.get(channel.slice(prefix.length + 1) as Channel)?.get(name)
        for (const handler of [...(listeners ?? [])]) {
          try {
            handler(envelope.data, envelope)
          } catch (error) {
            console.error(`[live] a ${name} handler failed`, error)
          }
        }
      },
      presence(channel, action, member) {
        if (gen !== generation || channel !== full('presence')) return
        if (presenceBuffer) presenceBuffer.push({ action, member })
        else {
          applyPresence(action, member)
          refreshOnline()
        }
      },
      state(state) {
        if (gen !== generation) return
        if (state === 'connected') {
          retries = 0
          setStatus('connected')
          if (!connectedOnce) {
            connectedOnce = true
            queueResync()
          }
          // A new connection has shared nothing yet.
          shared = null
          void sharePresence()
          if (transport) void loadMembers(transport, gen)
        } else if (state === 'failed') {
          drop()
          scheduleConnect()
        } else {
          setStatus(connectedOnce ? 'reconnecting' : 'connecting')
        }
      },
      discontinuity() {
        if (gen === generation) queueResync()
      },
    }
  }

  function drop() {
    generation++
    transport?.close()
    transport = null
    shared = null
    presenceBuffer = null
    members.clear()
    refreshOnline()
  }

  function scheduleConnect() {
    clearTimeout(retryTimer)
    setStatus(connectedOnce ? 'reconnecting' : 'connecting')
    const delay = Math.min(MAX_RETRY_MS, 1_000 * 2 ** retries++)
    retryTimer = setTimeout(() => void connect(), delay)
  }

  async function connect() {
    const gen = generation
    setStatus(connectedOnce ? 'reconnecting' : 'connecting')
    let token: Awaited<ReturnType<RenewToken>>
    try {
      token = await options.fetchToken()
    } catch (error) {
      if (gen !== generation || !started) return
      if (signedOut(error)) setStatus('off')
      else scheduleConnect()
      return
    }
    if (gen !== generation || !started) return
    if (token.transport === 'none') {
      setStatus('off')
      return
    }
    prefix = token.prefix
    let current: Transport | null
    try {
      current = await options.connect(token, transportEvents(gen), options.fetchToken)
    } catch (error) {
      console.warn('[live] could not connect', error)
      if (gen === generation && started) scheduleConnect()
      return
    }
    if (gen !== generation || !started) {
      current?.close()
      return
    }
    if (!current) {
      setStatus('off')
      return
    }
    transport = current
    current.attach(full('presence'), { presence: true })
    for (const channel of handlers.keys()) if (channel !== 'presence') current.attach(full(channel))
  }

  function watchVisibility() {
    const visibility = options.visibility
    if (!visibility) return
    unwatchVisibility = visibility.subscribe(() => {
      if (visibility.hidden()) {
        hiddenSince ??= Date.now()
        return
      }
      const awayFor = hiddenSince === null ? 0 : Date.now() - hiddenSince
      hiddenSince = null
      if (awayFor >= RESYNC_AFTER_HIDDEN_MS && status === 'connected') queueResync()
    })
  }

  function subscribeTo(set: Set<() => void>) {
    return (handler: () => void) => {
      set.add(handler)
      return () => {
        set.delete(handler)
      }
    }
  }

  return {
    get status() {
      return status
    },
    get online() {
      return online
    },
    on(channel, name, handler) {
      let byName = handlers.get(channel)
      if (!byName) {
        byName = new Map()
        handlers.set(channel, byName)
        if (transport && channel !== 'presence') transport.attach(full(channel))
      }
      let set = byName.get(name)
      if (!set) {
        set = new Set()
        byName.set(name, set)
      }
      const listener = handler as unknown as AnyHandler
      set.add(listener)
      const mineByName = byName
      const mineSet = set
      return () => {
        mineSet.delete(listener)
        if (mineSet.size === 0 && mineByName.get(name) === mineSet) mineByName.delete(name)
        if (mineByName.size === 0 && handlers.get(channel) === mineByName) {
          handlers.delete(channel)
          if (transport && channel !== 'presence') transport.detach(full(channel))
        }
      }
    },
    onResync: subscribeTo(resyncHandlers),
    onStatus: subscribeTo(statusHandlers),
    onOnline: subscribeTo(onlineHandlers),
    setRoom(room) {
      if (mine.room === room) return
      mine.room = room
      queuePresence()
    },
    setPlaying(playing) {
      if (mine.playing === playing) return
      mine.playing = playing
      queuePresence()
    },
    setAway(away) {
      if (mine.away === away) return
      mine.away = away
      queuePresence()
    },
    start() {
      if (started) return
      started = true
      retries = 0
      watchVisibility()
      void connect()
    },
    stop() {
      if (!started) return
      started = false
      clearTimeout(retryTimer)
      clearTimeout(presenceTimer)
      clearTimeout(resyncTimer)
      resyncTimer = undefined
      unwatchVisibility?.()
      unwatchVisibility = undefined
      hiddenSince = null
      // Closing the connection takes this tab out of presence.
      drop()
      connectedOnce = false
      setStatus('off')
    },
  }
}
