/**
 * React hooks over the live client. The shell creates one client per
 * signed-in player and puts it in a <LiveProvider>; everything below uses
 * the hooks.
 *
 *   useLiveEvent('room:coinflip', 'round.settled', (round) => seats.settle(round))
 *   useResync(() => queryClient.invalidateQueries({ queryKey: ['coinflip'] }))
 *   const online = useOnlinePlayers()
 */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useSyncExternalStore,
} from 'react'

import type { Channel, EventName } from '../../shared/events.ts'
import type { LiveClient, LiveHandler, LiveStatus } from './client.ts'
import type { OnlinePlayer } from './presence.ts'

const LiveContext = createContext<LiveClient | null>(null)

export function LiveProvider({ client, children }: { client: LiveClient; children: ReactNode }) {
  return <LiveContext value={client}>{children}</LiveContext>
}

export function useLive(): LiveClient {
  const client = useContext(LiveContext)
  if (!client) throw new Error('The live hooks need a <LiveProvider> above them.')
  return client
}

/**
 * Calls `handler` for each `name` event on `channel` while mounted. Pass a
 * null channel to listen to nothing. The handler always sees current props.
 */
export function useLiveEvent<C extends Channel, N extends EventName<C>>(
  channel: C | null,
  name: N,
  handler: LiveHandler<C, N>,
): void {
  const client = useLive()
  const onEvent = useEffectEvent(handler)
  useEffect(() => {
    if (!channel) return
    return client.on(channel, name, (data, envelope) => onEvent(data, envelope))
  }, [client, channel, name])
}

/** Runs `handler` whenever events may have been missed. Refetch there. */
export function useResync(handler: () => void): void {
  const client = useLive()
  const onResync = useEffectEvent(handler)
  useEffect(() => client.onResync(() => onResync()), [client])
}

export function useLiveStatus(): LiveStatus {
  const client = useLive()
  return useSyncExternalStore(client.onStatus, () => client.status)
}

/** Who is online, one entry per player. */
export function useOnlinePlayers(): readonly OnlinePlayer[] {
  const client = useLive()
  return useSyncExternalStore(client.onOnline, () => client.online)
}

/** Shares that this tab is in `room` while mounted. */
export function usePresenceRoom(room: string | null): void {
  const client = useLive()
  useEffect(() => {
    client.setRoom(room)
    return () => client.setRoom(null)
  }, [client, room])
}

/** Shares that this player has a round open while `playing` is true. */
export function usePlaying(playing: boolean): void {
  const client = useLive()
  useEffect(() => {
    client.setPlaying(playing)
    return () => client.setPlaying(false)
  }, [client, playing])
}

const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

/** Marks the player away after `minutes` without input (spec: Social layer). */
export function useAwayAfter(minutes: number): void {
  const client = useLive()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = 0
    const reset = () => {
      // Input arrives many times a second; one reset a second is plenty.
      const now = Date.now()
      if (now - last < 1_000) return
      last = now
      client.setAway(false)
      clearTimeout(timer)
      timer = setTimeout(() => client.setAway(true), minutes * 60_000)
    }
    reset()
    for (const name of INPUT_EVENTS) window.addEventListener(name, reset, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const name of INPUT_EVENTS) window.removeEventListener(name, reset)
    }
  }, [client, minutes])
}
