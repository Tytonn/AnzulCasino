/**
 * Live events from the server (spec: Live events). Only the server
 * publishes, and only after the commit, so a browser that hears an event and
 * fetches always finds the change:
 *
 *   chipTransaction(ctx, async (tx, afterCommit) => {
 *     const after = await debit(tx, { ... })
 *     afterCommit(() => publish(walletEvents(seasonId, userId, after)))
 *     ...
 *   })
 *
 * Where events go:
 * - With ABLY_API_KEY (Netlify): Ably, over HTTP, one request per publish.
 * - With LIVE_RELAY_URL (npm run dev, browser tests): the local relay in
 *   scripts/dev/live-relay.ts.
 * - With neither (unit and integration tests): nowhere, unless a test is
 *   capturing them with captureLive().
 *
 * Channel names carry a prefix per deploy: `anzul` for production,
 * `preview-<deploy id>` for previews, `local` in development. Previews and
 * the live site share one Ably app without ever hearing each other.
 *
 * A failed publish is logged and never fails the request: the database is
 * the truth, and browsers refetch on reconnect and focus.
 */
import { randomUUID } from 'node:crypto'

import { createHttpClient, type PubSubHttpClient } from '@ably/pubsub-server'

import type {
  Channel,
  EventName,
  EventsOn,
  LiveEnvelope,
  LiveTokenResponse,
  StandingChanged,
  WalletUpdated,
} from '../../shared/events.ts'
import { userChannel } from '../../shared/events.ts'
import { env } from './env.ts'
import { toWire } from './json.ts'
import { type Capability, signLocalToken } from './live-local.ts'

/** A browser token lasts this long; the browser renews it on its own. */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000

/** Event data as callers may write it: chip amounts as bigint or number. */
export type Publishable<T> = T extends number
  ? number | bigint
  : T extends readonly (infer U)[]
    ? Publishable<U>[]
    : T extends object
      ? { [K in keyof T]: Publishable<T[K]> }
      : T

export interface Outgoing {
  channel: Channel
  name: string
  envelope: LiveEnvelope
}

/**
 * Builds one event. `version` grows with each change to the thing the event
 * describes (see shared/events.ts), so browsers can drop stale news.
 */
export function liveEvent<C extends Channel, N extends EventName<C>>(
  channel: C,
  name: N,
  data: Publishable<EventsOn<C>[N]>,
  version = 0,
): Outgoing {
  return {
    channel,
    name,
    envelope: { id: randomUUID(), at: Date.now(), version, data: toWire(data) },
  }
}

/**
 * The news of a chip movement: the player's own wallet, and their row on the
 * leaderboard. Pass what debit, credit or transfer returned.
 */
export function walletEvents(
  seasonId: number,
  userId: string,
  after: { balance: bigint; vault: bigint; tier: string; ledgerId: number },
): Outgoing[] {
  const wallet: Publishable<WalletUpdated> = {
    seasonId,
    balance: after.balance,
    vault: after.vault,
  }
  const standing: Publishable<StandingChanged> = {
    seasonId,
    userId,
    balance: after.balance,
    vault: after.vault,
    netWorth: after.balance + after.vault,
    tier: after.tier,
  }
  return [
    liveEvent(userChannel(userId), 'wallet.updated', wallet, after.ledgerId),
    liveEvent('feed', 'standing.changed', standing, after.ledgerId),
  ]
}

// ---------------------------------------------------------------- deploy prefix

let prefix = 'local'

/**
 * Records which deploy is running, for channel names. createApi calls it on
 * every request; every request an instance serves belongs to one deploy.
 */
export function setDeployContext(deploy: { context?: string; id?: string } | undefined): void {
  if (!deploy?.context || deploy.context === 'dev') prefix = 'local'
  else if (deploy.context === 'production') prefix = 'anzul'
  else prefix = `preview-${deploy.id ?? 'unknown'}`
}

export function channelName(channel: Channel): string {
  return `${prefix}:${channel}`
}

/** What a player's browser may do: listen to the shared channels and its own, and share presence. */
export function capabilityFor(userId: string): Capability {
  return {
    // Operations in Ably's own (sorted) order, so both transports read the same.
    [channelName('presence')]: ['presence', 'subscribe'],
    [channelName('chat')]: ['subscribe'],
    [channelName('feed')]: ['subscribe'],
    [`${prefix}:room:*`]: ['subscribe'],
    [channelName(userChannel(userId))]: ['subscribe'],
  }
}

// ---------------------------------------------------------------- transports

interface WireMessage {
  channel: string
  name: string
  data: LiveEnvelope
}

interface Transport {
  send(messages: WireMessage[]): Promise<void>
  token(userId: string): Promise<LiveTokenResponse>
}

let ably: { key: string; client: PubSubHttpClient } | undefined

function ablyTransport(key: string): Transport {
  if (ably?.key !== key) ably = { key, client: createHttpClient({ key }) }
  const client = ably.client
  return {
    async send(messages) {
      const byChannel = new Map<string, { name: string; data: LiveEnvelope }[]>()
      for (const m of messages) {
        const list = byChannel.get(m.channel) ?? []
        list.push({ name: m.name, data: m.data })
        byChannel.set(m.channel, list)
      }
      // One HTTP request for every channel this publish touches.
      const results = await client.batchPublish(
        [...byChannel].map(([channel, list]) => ({ channels: [channel], messages: list })),
      )
      for (const result of results) {
        if (result.failureCount > 0) {
          throw new Error(`Ably refused ${result.failureCount} of the published channels`)
        }
      }
    },
    async token(userId) {
      const tokenRequest = await client.auth.createTokenRequest({
        clientId: userId,
        capability: capabilityFor(userId) as Record<string, ['*']>,
        ttl: TOKEN_TTL_MS,
      })
      return { transport: 'ably', prefix, clientId: userId, tokenRequest }
    },
  }
}

function localTransport(url: string, secret: string): Transport {
  return {
    async send(messages) {
      const res = await fetch(`${url}/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-live-secret': secret },
        body: JSON.stringify({ messages }),
      })
      if (!res.ok) throw new Error(`The local live relay answered ${res.status}`)
    },
    async token(userId) {
      const token = signLocalToken(
        { clientId: userId, capability: capabilityFor(userId), exp: Date.now() + TOKEN_TTL_MS },
        secret,
      )
      // The browser reaches the relay on its own origin, at the relay's path.
      return { transport: 'local', prefix, clientId: userId, token, url: new URL(url).pathname }
    },
  }
}

let captured: Outgoing[] | null = null

const noTransport: Transport = {
  async send() {},
  async token() {
    return { transport: 'none' }
  },
}

function transport(): Transport {
  const key = env('ABLY_API_KEY')
  if (key) return ablyTransport(key)
  const relay = env('LIVE_RELAY_URL')
  const secret = env('LIVE_RELAY_SECRET')
  if (relay && secret) return localTransport(relay, secret)
  return noTransport
}

/** Tests: records every published event until stop() is called. */
export function captureLive(): { events: Outgoing[]; stop(): void } {
  const events: Outgoing[] = []
  captured = events
  return {
    events,
    stop() {
      if (captured === events) captured = null
    },
  }
}

/**
 * Publishes events, in order per channel. Call it after the commit (through
 * chipTransaction's afterCommit, or once your transaction has returned).
 * Never throws.
 */
export async function publish(events: Outgoing[]): Promise<void> {
  if (events.length === 0) return
  captured?.push(...events)
  try {
    await transport().send(
      events.map((e) => ({ channel: channelName(e.channel), name: e.name, data: e.envelope })),
    )
  } catch (error) {
    console.error('[live] publish failed; browsers will catch up when they refetch', error)
  }
}

/** The browser's way in: GET /api/live/token. */
export function liveToken(userId: string): Promise<LiveTokenResponse> {
  return transport().token(userId)
}
