/**
 * The Ably transport, for every deployed site. Loaded on demand, so the
 * Ably client only downloads where it is used.
 *
 * The browser's token comes from GET /api/live/token: Ably asks for a new
 * one through authCallback before the old one runs out. The token can only
 * listen, share presence on the presence channel, and hear its own private
 * channel.
 */
import { createClient, type RealtimeChannel, type TokenRequest } from '@ably/pubsub-device'

import type { LiveEnvelope } from '../../shared/events.ts'
import type {
  AblyToken,
  PresenceAction,
  PresenceMember,
  RenewToken,
  Transport,
  TransportEvents,
} from './transport.ts'

function toMember(message: {
  clientId: string
  connectionId: string
  data: unknown
  timestamp: number
}): PresenceMember {
  return {
    clientId: message.clientId,
    connectionId: message.connectionId,
    data: message.data,
    timestamp: message.timestamp,
  }
}

export function createAblyTransport(
  first: AblyToken,
  events: TransportEvents,
  renew: RenewToken,
): Transport {
  let fresh: AblyToken | null = first
  const client = createClient({
    authCallback(_params, callback) {
      // The token the client was created with, then a new one each time.
      const ready = fresh
      fresh = null
      if (ready) return callback(null, ready.tokenRequest as TokenRequest)
      renew().then(
        (next) =>
          next.transport === 'ably'
            ? callback(null, next.tokenRequest as TokenRequest)
            : callback('Live updates are off.', null),
        (error: unknown) => callback(error instanceof Error ? error.message : String(error), null),
      )
    },
    clientId: first.clientId,
    // Only the server publishes, so there is nothing of ours to echo.
    echoMessages: false,
    closeOnUnload: true,
  })

  client.connection.on((change) => {
    switch (change.current) {
      case 'connecting':
        events.state('connecting')
        break
      case 'connected':
        events.state('connected')
        break
      case 'disconnected':
      case 'suspended':
        events.state('disconnected')
        break
      case 'failed':
        events.state('failed')
        break
    }
  })

  const channels = new Map<string, RealtimeChannel>()
  const entered = new Set<string>()

  return {
    attach(name, options) {
      if (channels.has(name)) return
      const channel = client.channels.get(name)
      channels.set(name, channel)
      let attachedBefore = false
      channel.on('attached', (change) => {
        // A reattach that could not resume may have dropped messages.
        if (attachedBefore && !change.resumed) events.discontinuity()
        attachedBefore = true
      })
      channel.on('update', (change) => {
        if (!change.resumed) events.discontinuity()
      })
      void channel
        .subscribe((message) =>
          events.message(name, message.name ?? '', message.data as LiveEnvelope),
        )
        .catch((error: unknown) => console.warn(`[live] could not listen to ${name}`, error))
      if (options?.presence) {
        void channel.presence
          .subscribe((message) => {
            const action: PresenceAction =
              message.action === 'leave' || message.action === 'absent'
                ? 'leave'
                : message.action === 'update'
                  ? 'update'
                  : 'enter'
            events.presence(name, action, toMember(message))
          })
          .catch((error: unknown) => console.warn(`[live] no presence on ${name}`, error))
      }
    },
    detach(name) {
      const channel = channels.get(name)
      if (!channel) return
      channels.delete(name)
      channel.unsubscribe()
      channel.presence.unsubscribe()
      void channel
        .detach()
        .then(() => client.channels.release(name))
        .catch(() => {})
    },
    async enterPresence(name, data) {
      const presence = client.channels.get(name).presence
      if (entered.has(name)) await presence.update(data)
      else await presence.enter(data)
      entered.add(name)
    },
    async leavePresence(name) {
      if (!entered.delete(name)) return
      await client.channels.get(name).presence.leave()
    },
    async presenceMembers(name) {
      const members = await client.channels.get(name).presence.get()
      return members.map(toMember)
    },
    close() {
      client.close()
    },
  }
}
