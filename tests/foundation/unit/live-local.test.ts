import { describe, expect, it } from 'vitest'

import { channelAllowed, signLocalToken, verifyLocalToken } from '../../../server/lib/live-local.ts'

const secret = 'test-secret'

describe('local live tokens', () => {
  it('round-trips a signed token', () => {
    const body = {
      clientId: 'u1',
      capability: { 'x:chat': ['subscribe'] },
      exp: Date.now() + 60_000,
    }
    expect(verifyLocalToken(signLocalToken(body, secret), secret)).toEqual(body)
  })

  it('rejects a token signed with another secret', () => {
    const token = signLocalToken(
      { clientId: 'u1', capability: {}, exp: Date.now() + 60_000 },
      'other',
    )
    expect(verifyLocalToken(token, secret)).toBeNull()
  })

  it('rejects a tampered token', () => {
    const token = signLocalToken(
      { clientId: 'u1', capability: {}, exp: Date.now() + 60_000 },
      secret,
    )
    const [, sig] = token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ clientId: 'admin', capability: { '*': ['*'] }, exp: Date.now() + 60_000 }),
    ).toString('base64url')
    expect(verifyLocalToken(`${forged}.${sig}`, secret)).toBeNull()
  })

  it('rejects an expired token', () => {
    const token = signLocalToken({ clientId: 'u1', capability: {}, exp: Date.now() - 1 }, secret)
    expect(verifyLocalToken(token, secret)).toBeNull()
  })

  it('rejects garbage', () => {
    expect(verifyLocalToken('', secret)).toBeNull()
    expect(verifyLocalToken('a.b.c', secret)).toBeNull()
    expect(verifyLocalToken('not-a-token', secret)).toBeNull()
  })
})

describe('channelAllowed', () => {
  const capability = {
    'live:presence': ['presence', 'subscribe'],
    'live:chat': ['subscribe'],
    'live:room:*': ['subscribe'],
    'live:user:u1': ['subscribe'],
  }

  it('allows exactly what the capability names', () => {
    expect(channelAllowed(capability, 'live:chat', 'subscribe')).toBe(true)
    expect(channelAllowed(capability, 'live:presence', 'presence')).toBe(true)
    expect(channelAllowed(capability, 'live:user:u1', 'subscribe')).toBe(true)
  })

  it('matches a trailing wildcard on whole segments', () => {
    expect(channelAllowed(capability, 'live:room:coinflip', 'subscribe')).toBe(true)
    expect(channelAllowed(capability, 'live:roomy', 'subscribe')).toBe(false)
  })

  it('refuses other operations and other channels', () => {
    expect(channelAllowed(capability, 'live:chat', 'presence')).toBe(false)
    expect(channelAllowed(capability, 'live:chat', 'publish')).toBe(false)
    expect(channelAllowed(capability, 'live:user:u2', 'subscribe')).toBe(false)
    expect(channelAllowed(capability, 'preview:chat', 'subscribe')).toBe(false)
  })
})
