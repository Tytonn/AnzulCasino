/**
 * The server side of the live layer (spec: Live events): channel names per
 * deploy, what a browser token allows, the event envelope, and publishing
 * that never fails a request.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chips } from '../../../shared/chips.ts'
import {
  capabilityFor,
  captureLive,
  channelName,
  liveEvent,
  liveToken,
  publish,
  setDeployContext,
  walletEvents,
} from '../../../server/lib/live.ts'
import { channelAllowed, verifyLocalToken } from '../../../server/lib/live-local.ts'

const ENV_KEYS = ['ABLY_API_KEY', 'LIVE_RELAY_URL', 'LIVE_RELAY_SECRET'] as const
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  setDeployContext(undefined)
  vi.restoreAllMocks()
})

function useRelay() {
  delete process.env.ABLY_API_KEY
  process.env.LIVE_RELAY_URL = 'http://localhost:8888/__live'
  process.env.LIVE_RELAY_SECRET = 'relay-secret'
}

function useNoTransport() {
  for (const key of ENV_KEYS) delete process.env[key]
}

describe('channel names', () => {
  it('carry one prefix per deploy, so previews never reach the live site', () => {
    setDeployContext(undefined)
    expect(channelName('feed')).toBe('local:feed')
    setDeployContext({ context: 'dev', id: '0' })
    expect(channelName('chat')).toBe('local:chat')
    setDeployContext({ context: 'production', id: 'p1' })
    expect(channelName('user:u1')).toBe('anzul:user:u1')
    setDeployContext({ context: 'deploy-preview', id: 'abc123' })
    expect(channelName('room:coinflip')).toBe('preview-abc123:room:coinflip')
    setDeployContext({ context: 'branch-deploy', id: 'def456' })
    expect(channelName('presence')).toBe('preview-def456:presence')
  })
})

describe('what a browser token allows', () => {
  const capability = () => capabilityFor('alice')

  it('listens to the shared channels, every room and only its own private channel', () => {
    setDeployContext({ context: 'production', id: 'p1' })
    const allowed = (channel: string) => channelAllowed(capability(), channel, 'subscribe')
    expect(allowed('anzul:feed')).toBe(true)
    expect(allowed('anzul:chat')).toBe(true)
    expect(allowed('anzul:presence')).toBe(true)
    expect(allowed('anzul:room:blackjack')).toBe(true)
    expect(allowed('anzul:room:russian-roulette')).toBe(true)
    expect(allowed('anzul:user:alice')).toBe(true)
    expect(allowed('anzul:user:bob')).toBe(false)
    expect(allowed('preview-x:feed')).toBe(false)
  })

  it('shares presence only on the presence channel, and never publishes', () => {
    setDeployContext({ context: 'production', id: 'p1' })
    expect(channelAllowed(capability(), 'anzul:presence', 'presence')).toBe(true)
    expect(channelAllowed(capability(), 'anzul:room:blackjack', 'presence')).toBe(false)
    for (const channel of ['anzul:chat', 'anzul:feed', 'anzul:user:alice', 'anzul:room:x']) {
      expect(channelAllowed(capability(), channel, 'publish'), channel).toBe(false)
    }
  })
})

describe('events', () => {
  it('are self-contained: an id, the server time, a version and wire data', () => {
    const before = Date.now()
    const a = liveEvent('chat', 'chat.deleted', { id: 7 }, 7)
    const b = liveEvent('chat', 'chat.deleted', { id: 7 }, 7)
    expect(a.envelope.id).not.toBe(b.envelope.id)
    expect(a.envelope.at).toBeGreaterThanOrEqual(before)
    expect(a).toMatchObject({ channel: 'chat', name: 'chat.deleted', envelope: { version: 7 } })
    expect(a.envelope.data).toEqual({ id: 7 })
  })

  it('tell a player about their wallet and everyone about their standing', () => {
    const [wallet, standing] = walletEvents('7' as unknown as number, 'alice', {
      balance: chips(90),
      vault: chips(10),
      tier: 'bronze',
      ledgerId: 41,
    })
    expect(wallet).toMatchObject({
      channel: 'user:alice',
      name: 'wallet.updated',
      envelope: { version: 41, data: { seasonId: '7', balance: 9_000, vault: 1_000 } },
    })
    expect(standing).toMatchObject({
      channel: 'feed',
      name: 'standing.changed',
      envelope: {
        version: 41,
        data: { userId: 'alice', balance: 9_000, vault: 1_000, netWorth: 10_000, tier: 'bronze' },
      },
    })
  })
})

describe('publish', () => {
  it('sends events to the local relay with the deploy prefix', async () => {
    useRelay()
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const events = liveEvent('chat', 'chat.deleted', { id: 3 }, 3)
    await publish([events])

    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8888/__live/publish')
    expect(new Headers(init.headers).get('x-live-secret')).toBe('relay-secret')
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ channel: 'local:chat', name: 'chat.deleted', data: events.envelope }],
    })
  })

  it('never throws: a failed publish is logged and the request goes on', async () => {
    useRelay()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('relay down'))
    await expect(publish([liveEvent('chat', 'chat.deleted', { id: 1 })])).resolves.toBeUndefined()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('no', { status: 500 }))
    await expect(publish([liveEvent('chat', 'chat.deleted', { id: 2 })])).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('goes nowhere without a transport, but tests can capture it', async () => {
    useNoTransport()
    const fetch = vi.spyOn(globalThis, 'fetch')
    const capture = captureLive()
    await publish([liveEvent('feed', 'season.state', { seasonId: 1, phase: 'open' })])
    await publish([])
    capture.stop()
    await publish([liveEvent('feed', 'season.state', { seasonId: 2, phase: 'open' })])
    expect(fetch).not.toHaveBeenCalled()
    expect(capture.events.map((e) => e.envelope.data)).toEqual([{ seasonId: 1, phase: 'open' }])
  })
})

describe('liveToken', () => {
  it('says so when live updates are off', async () => {
    useNoTransport()
    expect(await liveToken('alice')).toEqual({ transport: 'none' })
  })

  it('signs a local relay token for the player only', async () => {
    useRelay()
    const token = await liveToken('alice')
    expect(token).toMatchObject({
      transport: 'local',
      prefix: 'local',
      clientId: 'alice',
      url: '/__live',
    })
    if (token.transport !== 'local') throw new Error('expected a local token')
    const body = verifyLocalToken(token.token, 'relay-secret')
    expect(body?.clientId).toBe('alice')
    expect(body?.capability).toEqual(capabilityFor('alice'))
    expect(body && body.exp - Date.now()).toBeGreaterThan(11 * 3_600_000)
  })

  it('signs an Ably token request with the same capability, without a network call', async () => {
    process.env.ABLY_API_KEY = 'appid.keyid:not-a-real-secret'
    setDeployContext({ context: 'deploy-preview', id: 'abc' })
    const fetch = vi.spyOn(globalThis, 'fetch')
    const token = await liveToken('alice')
    expect(fetch).not.toHaveBeenCalled()
    expect(token).toMatchObject({ transport: 'ably', prefix: 'preview-abc', clientId: 'alice' })
    if (token.transport !== 'ably') throw new Error('expected an Ably token')
    const request = token.tokenRequest as Record<string, unknown>
    expect(request.keyName).toBe('appid.keyid')
    expect(request.clientId).toBe('alice')
    expect(JSON.parse(String(request.capability))).toEqual(capabilityFor('alice'))
    expect(JSON.stringify(token)).not.toContain('not-a-real-secret')
  })
})
