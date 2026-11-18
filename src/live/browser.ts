/**
 * The live client as the site uses it: tokens from GET /api/live/token, the
 * transport the token names, and the page's visibility.
 */
import type { LiveTokenResponse } from '../../shared/events.ts'
import { type Connect, createLiveClient, type LiveClient, type Visibility } from './client.ts'
import { createLocalTransport } from './local-transport.ts'

export async function fetchLiveToken(): Promise<LiveTokenResponse> {
  const res = await fetch('/api/live/token', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    throw Object.assign(new Error(`GET /api/live/token answered ${res.status}`), {
      status: res.status,
    })
  }
  return (await res.json()) as LiveTokenResponse
}

/** Ably loads only when a token asks for it, so local development never downloads it. */
export const connectTransport: Connect = async (token, events, renew) => {
  if (token.transport === 'local') return createLocalTransport(token, events, renew)
  if (token.transport === 'ably') {
    const { createAblyTransport } = await import('./ably-transport.ts')
    return createAblyTransport(token, events, renew)
  }
  return null
}

export const documentVisibility: Visibility = {
  hidden: () => document.visibilityState === 'hidden',
  subscribe(onChange) {
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  },
}

export function createBrowserLiveClient(): LiveClient {
  return createLiveClient({
    fetchToken: fetchLiveToken,
    connect: connectTransport,
    visibility: documentVisibility,
  })
}
