/**
 * Tokens and channel matching for the local live relay (scripts/dev/live-relay.ts),
 * which stands in for Ably in local dev and CI. Never used on Netlify.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Ably capability shape: channel pattern -> allowed operations. */
export type Capability = Record<string, string[]>

export interface LocalTokenBody {
  clientId: string
  capability: Capability
  /** Expiry, epoch milliseconds. */
  exp: number
}

export function signLocalToken(body: LocalTokenBody, secret: string): string {
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyLocalToken(token: string, secret: string): LocalTokenBody | null {
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', secret).update(payload).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString()) as LocalTokenBody
    return body.exp > Date.now() ? body : null
  } catch {
    return null
  }
}

/**
 * Ably's matching rules: `*` replaces whole `:`-separated segments, so `a:*`
 * matches `a:b` and `a:b:c` but not `a`. `subscribe` covers presence-subscribe.
 */
export function channelAllowed(capability: Capability, channel: string, op: string): boolean {
  for (const [pattern, ops] of Object.entries(capability)) {
    if (!ops.includes(op) && !ops.includes('*')) continue
    if (pattern === '*' || pattern === channel) return true
    if (pattern.endsWith(':*') && channel.startsWith(pattern.slice(0, -1))) return true
  }
  return false
}
