/**
 * Everything behind the sign-in: one live client per player, the caches kept
 * current, and the shell around the page.
 */
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import type { Me } from '../../shared/accounts.ts'
import { syncClock } from '../kit/clock.ts'
import { LogoMark } from './Logo.tsx'
import { useSession } from '../kit/queries.ts'
import { useSound } from '../kit/sound.ts'
import { createBrowserLiveClient, LiveProvider } from '../live/index.ts'
import { Shell } from './layout/Shell.tsx'
import { LiveSync } from './LiveSync.tsx'

function Boot({ retry }: { retry?: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className={`size-12 text-text ${retry ? '' : 'animate-pulse'}`} />
        {retry && (
          <>
            <p className="text-muted">Could not reach the casino. Check your connection.</p>
            <button
              type="button"
              onClick={retry}
              className="h-10 rounded-md bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-strong"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </main>
  )
}

function Session({ me }: { me: Me }) {
  const [client] = useState(createBrowserLiveClient)

  useEffect(() => {
    client.start()
    return () => client.stop()
  }, [client])

  useEffect(() => {
    useSound.setState({ muted: me.soundMuted, volume: me.soundVolume })
  }, [me.soundMuted, me.soundVolume])

  useEffect(() => {
    syncClock().catch((error: unknown) => console.warn('[clock] could not sync', error))
  }, [])

  return (
    <LiveProvider client={client}>
      <LiveSync me={me} />
      <Shell />
    </LiveProvider>
  )
}

export function SignedIn() {
  const session = useSession()
  const location = useLocation()
  if (session.isPending) return <Boot />
  if (session.isError) return <Boot retry={() => void session.refetch()} />
  if (!session.data) {
    const next =
      location.pathname === '/'
        ? ''
        : `?next=${encodeURIComponent(location.pathname + location.search)}`
    return <Navigate to={`/login${next}`} replace />
  }
  // A different player gets a fresh live client.
  return <Session key={session.data.id} me={session.data} />
}
