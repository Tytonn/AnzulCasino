/**
 * The live layer for the browser (spec: Live events). Import from here:
 *
 *   import { useLiveEvent, useResync, useOnlinePlayers } from '../../live'
 *
 * Event names and payloads are in shared/events.ts.
 */
export { createBrowserLiveClient } from './browser.ts'
export {
  createLiveClient,
  type LiveClient,
  type LiveHandler,
  type LiveStatus,
  RESYNC_AFTER_HIDDEN_MS,
} from './client.ts'
export { type OnlinePlayer, onlinePlayers, readPresence } from './presence.ts'
export {
  LiveProvider,
  useAwayAfter,
  useLive,
  useLiveEvent,
  useLiveStatus,
  useOnlinePlayers,
  usePlaying,
  usePresenceRoom,
  useResync,
} from './react.tsx'
export { isNewer } from './versions.ts'
