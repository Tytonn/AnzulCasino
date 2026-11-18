/**
 * How games and features plug into the shell without editing it (spec:
 * Manifests). A lane adds one file, and the shell finds it:
 *
 *   src/games/<id>/manifest.ts       export default defineGame({ ... })
 *   src/features/<name>/manifest.ts  export default defineFeature({ ... })
 *
 * A game brings its room, how-to-play card and replay. A feature brings
 * pages, extra nav items, and components for the shell's slots: the top bar,
 * the profile card, chat, banners, overlays and shop items. Pages and rooms
 * load on demand, so a manifest stays small.
 */
import type { ComponentType } from 'react'

import type { ChatMessage } from '../../shared/chat.ts'
import type { PlayerSummary } from '../../shared/players.ts'
import type { RoundView } from '../../shared/rounds.ts'
import type { Icon } from '../kit/icons.tsx'

/** A module loaded when first needed: `() => import('./Room.tsx')`. */
export type Lazy<P = object> = () => Promise<{ default: ComponentType<P> }>

// ---------------------------------------------------------------- games

export interface GameManifest {
  /**
   * The game's name in code: its room (/room/<id>), its live channel
   * (room:<id>), its API paths (/api/<id>/*) and its rounds' `game`.
   */
  id: string
  /** On the rail, the Floor and in the ticker. */
  name: string
  /** Place on the rail and the Floor: smaller first. */
  order: number
  /** The room, loaded when a player walks in. */
  room: Lazy
  /** The how-to-play card: a few short paragraphs. */
  howToPlay: readonly string[]
  /** Its icon. Planned games have one drawn by the shell already. */
  icon?: Icon
  /** Art for its Floor card, drawn in the card's top half. */
  cardArt?: ComponentType
  /** Replays a saved round from its detail (History and the ticker). */
  replay?: Lazy<{ round: RoundView }>
}

// ---------------------------------------------------------------- features

export interface FeatureRoute {
  /**
   * Such as /shop or /history/:roundId. A path the shell holds a placeholder
   * for (see src/shell/planned.ts) replaces the placeholder.
   */
  path: string
  page: Lazy
  /** The browser tab's title. */
  title: string
  adminOnly?: boolean
}

export interface NavItem {
  to: string
  label: string
  icon?: Icon
  /** Place among the rail's page links: Floor is 0, Leaderboard 10 ... Admin 50. */
  order: number
  adminOnly?: boolean
}

/** One component in a slot. */
export interface SlotEntry<P> {
  /** Unique, such as "economy.work". */
  id: string
  /** Smaller first. */
  order: number
  component: ComponentType<P>
  adminOnly?: boolean
}

/**
 * The props each slot hands its components. A lane can add a slot of its own
 * (say, for other lanes to fill its page) by extending this interface from
 * its own file:
 *
 *   declare module '../../shell/manifests.ts' {
 *     interface SlotProps { 'heist.vault-panel': { wallet: number } }
 *   }
 */
export interface SlotProps {
  /**
   * The top bar, in every room, on desktop and phone: the work, slut and
   * crime buttons, Collect, shield pips, steal attempts. `compact` is true on
   * a phone, where each widget gets about 4.5rem: show an icon and the
   * cooldown, and put the label in `title`/aria-label.
   */
  'top-bar': { compact: boolean }
  /** Buttons on a player's profile card, such as Steal. */
  'profile-actions': { player: PlayerSummary }
  /** Sections on a player's profile card, such as season stats. */
  'profile-sections': { player: PlayerSummary }
  /**
   * Beside the chat box, such as the GIF picker. Call `sent` with what the
   * server saved, so it shows at once without waiting for the live echo.
   */
  'chat-composer': { sent(message: ChatMessage): void }
  /** Under each chat message, such as reactions. */
  'chat-message': { message: ChatMessage }
  /** Above the page in the center column, such as the final-day banner. */
  banner: Record<string, never>
  /** Mounted once for the whole session: notification toasts, celebrations. */
  overlay: Record<string, never>
  /** Cards on the Shop page (the heist lane's), from any lane: shields, ranks. */
  'shop-items': Record<string, never>
}

export type SlotName = keyof SlotProps

export type Slots = { [K in SlotName]?: readonly SlotEntry<SlotProps[K]>[] }

export interface FeatureManifest {
  /** The lane's name, such as "economy". */
  id: string
  routes?: readonly FeatureRoute[]
  /** Extra links on the rail. The spec's own pages are already there. */
  nav?: readonly NavItem[]
  slots?: Slots
}

/** Declares a game's manifest with its types checked. */
export function defineGame(manifest: GameManifest): GameManifest {
  return manifest
}

/** Declares a feature's manifest with its types checked. */
export function defineFeature(manifest: FeatureManifest): FeatureManifest {
  return manifest
}
