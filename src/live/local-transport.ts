/**
 * The local relay transport: Server-Sent Events from scripts/dev/live-relay.ts,
 * which runs inside the Vite dev server. Development and browser tests only;
 * a deployed site always gets an Ably token instead.
 *
 * The relay keeps no history, so every new connection is a discontinuity
 * and the client refetches.
 */
import type { LiveEnvelope } from '../../shared/events.ts'
import type {
  LocalToken,
  PresenceAction,
  PresenceMember,
  RenewToken,
  Transport,
  TransportEvents,
} from './transport.ts'

type Frame =
  | { type: 'ready'; connectionId: string }
  | { type: 'message'; channel: string; name: string; data: LiveEnvelope }
  | { type: 'presence'; channel: string; action: PresenceAction; member: PresenceMember }

const MAX_RETRY_MS = 30_000

export function createLocalTransport(
  first: LocalToken,
  events: TransportEvents,
  renew: RenewToken,
): Transport {
  let token = first
  let source: EventSource | null = null
  let connectionId: string | null = null
  let closed = false
  let retries = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const attached = new Set<string>()
  const entered = new Set<string>()

  function open() {
    if (closed) return
    events.state('connecting')
    const stream = new EventSource(`${token.url}/stream?token=${encodeURIComponent(token.token)}`)
    source = stream
    stream.onmessage = (event: MessageEvent<string>) => {
      let frame: Frame
      try {
        frame = JSON.parse(event.data) as Frame
      } catch {
        return
      }
      if (frame.type === 'ready') {
        connectionId = frame.connectionId
        entered.clear()
        retries = 0
        events.state('connected')
        events.discontinuity()
      } else if (frame.type === 'message') {
        if (attached.has(frame.channel)) events.message(frame.channel, frame.name, frame.data)
      } else if (frame.type === 'presence') {
        if (attached.has(frame.channel)) events.presence(frame.channel, frame.action, frame.member)
      }
    }
    stream.onerror = () => {
      connectionId = null
      events.state('disconnected')
      // While CONNECTING the browser retries by itself. CLOSED means the relay
      // refused the token (it expired, or the dev server restarted with a new
      // secret), so ask for a new one.
      if (stream.readyState === EventSource.CLOSED) {
        source = null
        const delay = Math.min(MAX_RETRY_MS, 1_000 * 2 ** retries++)
        retryTimer = setTimeout(() => void reopen(), delay)
      }
    }
  }

  async function reopen() {
    if (closed) return
    try {
      const next = await renew()
      if (next.transport !== 'local') {
        events.state('failed')
        return
      }
      token = next
    } catch {
      // Keep the old token and try again; the next failure backs off further.
    }
    open()
  }

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`${token.url}/presence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.token, connectionId, ...body }),
    })
    if (!res.ok) throw new Error(`The live relay answered ${res.status}`)
  }

  open()

  return {
    attach(channel) {
      attached.add(channel)
    },
    detach(channel) {
      attached.delete(channel)
    },
    async enterPresence(channel, data) {
      if (!connectionId) return
      await post({ channel, action: entered.has(channel) ? 'update' : 'enter', data })
      entered.add(channel)
    },
    async leavePresence(channel) {
      if (!connectionId || !entered.has(channel)) return
      entered.delete(channel)
      await post({ channel, action: 'leave' })
    },
    async presenceMembers(channel) {
      const query = new URLSearchParams({ token: token.token, channel })
      const res = await fetch(`${token.url}/presence?${query}`)
      if (!res.ok) throw new Error(`The live relay answered ${res.status}`)
      const body = (await res.json()) as { members: PresenceMember[] }
      return body.members
    },
    close() {
      closed = true
      clearTimeout(retryTimer)
      source?.close()
      source = null
    },
  }
}
